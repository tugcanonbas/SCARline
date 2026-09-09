from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from websockets.asyncio.client import connect

from .config import Settings
from .journal import CommandJournal
from .models import protocol_message, require_number, require_uuid, timestamp, validate_session_configuration
from .runtime import CarlaRuntime

LOGGER = logging.getLogger("scarline.carla-client")

CAPABILITIES = [
    "vehicle.telemetry", "vehicle-control", "map-loading", "weather-control",
    "vehicle-spawning", "sensor-management", "traffic-management", "pedestrian-management",
    "recording", "spectator-control", "collision-events", "lane-invasion-events",
    "camera-reference", "lidar-reference", "gnss", "imu",
]


class CarlaAdapter:
    def __init__(self, settings: Settings, runtime: CarlaRuntime | None = None) -> None:
        self.settings = settings
        self.runtime = runtime or CarlaRuntime(settings)
        self.journal = CommandJournal(settings.command_journal)
        self.active_configuration = self.journal.active_configuration
        self.paused = self.journal.paused
        self.socket: Any = None
        self.registered = False
        self.heartbeat_interval = 5.0
        self.send_lock = asyncio.Lock()
        self.stop_event = asyncio.Event()
        self.disconnected_at: float | None = None

    async def run(self) -> None:
        await self._recover()
        while not self.stop_event.is_set():
            if self.active_configuration is not None and self.disconnected_at is not None:
                disconnected_for = asyncio.get_running_loop().time() - self.disconnected_at
                if disconnected_for > self.settings.reconnect_grace:
                    LOGGER.error("Sim-Bridge reconnect grace expired; releasing CARLA session")
                    await asyncio.to_thread(self.runtime.unbind)
                    self.active_configuration = None; self.paused = False
                    self.journal.set_state(None, False)
            try:
                async with connect(
                    self.settings.bridge_url,
                    additional_headers={"authorization": f"Bearer {self.settings.adapter_secret}"},
                    max_size=self.settings.maximum_message_bytes,
                    open_timeout=10,
                    close_timeout=5,
                ) as socket:
                    self.socket = socket; self.registered = False
                    await self._send(protocol_message(
                        "adapter.register",
                        adapterId=self.settings.adapter_id,
                        name="SCARline CARLA Adapter",
                        simulatorType="carla",
                        simulatorVersion=self.settings.expected_carla_version,
                        capabilities=CAPABILITIES,
                        priority=self.settings.priority,
                        activeSessionId=self.active_configuration["sessionId"] if self.active_configuration else None,
                    ))
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    tick_task = asyncio.create_task(self._tick_loop())
                    try:
                        async for raw in socket:
                            await self._handle_message(json.loads(raw))
                    finally:
                        heartbeat_task.cancel(); tick_task.cancel()
                        await asyncio.gather(heartbeat_task, tick_task, return_exceptions=True)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                LOGGER.warning("CARLA adapter connection failed: %s", error)
            finally:
                self.socket = None; self.registered = False
                if self.disconnected_at is None: self.disconnected_at = asyncio.get_running_loop().time()
            try: await asyncio.wait_for(self.stop_event.wait(), timeout=self.settings.reconnect_interval)
            except TimeoutError: pass

    async def stop(self) -> None:
        self.stop_event.set()
        if self.socket is not None: await self.socket.close(code=1000, reason="CARLA adapter is shutting down")
        await asyncio.to_thread(self.runtime.close)

    async def _recover(self) -> None:
        if self.active_configuration is None:
            await asyncio.to_thread(self.runtime.connect)
            return
        try:
            configuration = validate_session_configuration({
                **self.active_configuration,
                "deadlineAt": timestamp(),
            })
            await asyncio.to_thread(self.runtime.recover, configuration, self.paused)
            self.active_configuration = configuration
        except Exception:
            LOGGER.exception("Recorded CARLA session could not be recovered")
            self.active_configuration = None; self.paused = False
            self.journal.set_state(None, False)
            await asyncio.to_thread(self.runtime.connect)

    async def _handle_message(self, message: Any) -> None:
        if not isinstance(message, dict) or message.get("version") != 1 or not isinstance(message.get("type"), str):
            raise ValueError("Invalid Sim-Bridge message")
        message_type = message["type"]
        if message_type == "adapter.registered":
            require_uuid(message.get("correlationId"), "correlationId")
            self.heartbeat_interval = max(0.1, float(message["heartbeatIntervalMilliseconds"]) / 1000)
            self.registered = True
            self.disconnected_at = None
            await self._heartbeat()
            return
        if message_type == "bridge.error":
            LOGGER.error("Sim-Bridge error %s: %s", message.get("code"), message.get("message")); return
        if not self.registered: raise ValueError("Sim-Bridge sent a command before registration completed")
        if message_type == "adapter.vehicle_control":
            control = self._vehicle_control(message)
            await asyncio.to_thread(self.runtime.apply_realtime_control, control)
            return
        await self._handle_command(message)

    async def _handle_command(self, message: dict[str, Any]) -> None:
        command_id = require_uuid(message.get("commandId"), "commandId")
        cached = self.journal.get(command_id)
        if cached is not None: await self._send(cached); return
        try:
            deadline = datetime.fromisoformat(str(message["deadlineAt"]).replace("Z", "+00:00"))
            if deadline <= datetime.now(UTC): raise CommandFailure("COMMAND_EXPIRED", "Command deadline has passed")
            detail = await self._apply_command(message)
            result = self._result(command_id, True, "COMPLETED", detail)
        except CommandFailure as error:
            result = self._result(command_id, False, error.code, str(error))
        except Exception as error:
            LOGGER.exception("CARLA command failed")
            result = self._result(command_id, False, "CARLA_COMMAND_FAILED", str(error)[:2000])
        self.journal.record(command_id, result, self.active_configuration, self.paused)
        await self._send(result)
        if result["success"]:
            if message["type"] == "adapter.pause_session": await self._send_event({"type":"simulator.state","state":"paused","details":{}})
            elif message["type"] == "adapter.unbind_session": return
            else: await self._send_event({"type":"simulator.state","state":"running","details":{}})

    async def _apply_command(self, message: dict[str, Any]) -> str:
        message_type = message["type"]
        if message_type == "adapter.bind_session":
            configuration = validate_session_configuration(message)
            if self.active_configuration and self.active_configuration["sessionId"] != configuration["sessionId"]:
                raise CommandFailure("SESSION_CONFLICT", "CARLA is already bound to another session")
            await asyncio.to_thread(self.runtime.bind, configuration)
            self.active_configuration = configuration; self.paused = False
            return "CARLA session configured and started"
        session_id = require_uuid(message.get("sessionId"), "sessionId")
        if self.active_configuration is None or self.active_configuration["sessionId"] != session_id:
            if message_type == "adapter.unbind_session":
                self.active_configuration = None; self.paused = False
                return "No matching CARLA session required cleanup"
            raise CommandFailure("SESSION_NOT_BOUND", "CARLA is not bound to this session")
        if message_type == "adapter.advance_session":
            configuration = validate_session_configuration(message)
            await asyncio.to_thread(self.runtime.advance, configuration)
            self.active_configuration = configuration; self.paused = False
            return "CARLA advanced to the next condition"
        if message_type == "adapter.pause_session":
            await asyncio.to_thread(self.runtime.pause); self.paused = True; return "CARLA session paused"
        if message_type == "adapter.resume_session":
            await asyncio.to_thread(self.runtime.resume); self.paused = False; return "CARLA session resumed"
        if message_type == "adapter.unbind_session":
            artifact = await asyncio.to_thread(self.runtime.unbind)
            self.active_configuration = None; self.paused = False
            if artifact is not None: await self._send_event(artifact)
            return "CARLA session released"
        if message_type == "adapter.simulator_command":
            required = message.get("requiredCapability")
            if required is not None and required not in CAPABILITIES:
                raise CommandFailure("CAPABILITY_UNAVAILABLE", f"Unsupported capability: {required}")
            parameters = message.get("parameters")
            if not isinstance(parameters, dict): raise CommandFailure("INVALID_PARAMETERS", "Command parameters must be an object")
            return await asyncio.to_thread(self.runtime.command, str(message.get("command")), parameters)
        raise CommandFailure("UNSUPPORTED_COMMAND", f"Unsupported adapter command: {message_type}")

    def _vehicle_control(self, message: dict[str, Any]) -> dict[str, Any]:
        return {
            "studyId": require_uuid(message.get("studyId"), "studyId"),
            "sessionId": require_uuid(message.get("sessionId"), "sessionId"),
            "sessionConditionId": require_uuid(message.get("sessionConditionId"), "sessionConditionId"),
            "sourceKey": str(message.get("sourceKey")),
            "sequence": int(message.get("sequence", -1)),
            "sourceTimestamp": str(message.get("sourceTimestamp")),
            "throttle": require_number(message.get("throttle"), "throttle", 0, 1),
            "steer": require_number(message.get("steer"), "steer", -1, 1),
            "brake": require_number(message.get("brake"), "brake", 0, 1),
        }

    def _result(self, command_id: str, success: bool, code: str, message: str) -> dict[str, Any]:
        return protocol_message(
            "adapter.command_result", commandId=command_id, success=success,
            code=code, message=message[:2000], details={},
            activeSessionId=self.active_configuration["sessionId"] if self.active_configuration else None,
        )

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_interval)
            if self.registered: await self._heartbeat()

    async def _heartbeat(self) -> None:
        await self._send(protocol_message(
            "adapter.heartbeat",
            status="busy" if self.active_configuration else "ready",
            activeSessionId=self.active_configuration["sessionId"] if self.active_configuration else None,
        ))

    async def _tick_loop(self) -> None:
        while True:
            if not self.registered or self.active_configuration is None or self.paused:
                await asyncio.sleep(0.05); continue
            try:
                messages = await asyncio.to_thread(self.runtime.tick)
                for message in messages: await self._send_event(message)
            except asyncio.CancelledError: raise
            except Exception as error:
                LOGGER.exception("CARLA simulation tick failed")
                await self._send_event({"type":"adapter.error","code":"CARLA_TICK_FAILED","message":str(error)[:2000],"fatal":True,"details":{}})
                await asyncio.to_thread(self.runtime.unbind)
                self.active_configuration = None; self.paused = False
                self.journal.set_state(None, False)

    async def _send_event(self, value: dict[str, Any]) -> None:
        fields = dict(value); message_type = str(fields.pop("type"))
        await self._send(protocol_message(message_type, **fields))

    async def _send(self, message: dict[str, Any]) -> None:
        if self.socket is None: return
        encoded = json.dumps(message, separators=(",", ":"))
        if len(encoded.encode()) > self.settings.maximum_message_bytes: raise ValueError("CARLA adapter message exceeds the configured limit")
        async with self.send_lock: await self.socket.send(encoded)


class CommandFailure(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message); self.code = code

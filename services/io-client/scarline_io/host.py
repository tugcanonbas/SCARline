from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

import aio_pika

from .catalogue import discover_driver_types, load_manifests
from .drivers import SensorDriver
from .journal import CommandJournal
from .models import Reading, envelope, timestamp

LOGGER = logging.getLogger("scarline.io-client")


@dataclass
class ActiveDevice:
    session_id: str
    study_id: str
    condition_id: str
    device: dict[str, Any]
    driver: SensorDriver
    tasks: list[asyncio.Task[None]] = field(default_factory=list)
    failed: bool = False


class IoHost:
    def __init__(self, options: Any) -> None:
        self.options = options
        self.instance_id = str(uuid4())
        self.manifests = load_manifests(Path(options.drivers_directory))
        self.driver_types = discover_driver_types()
        self.journal = CommandJournal(Path(options.command_journal))
        self.active: dict[str, ActiveDevice] = {}
        self.connection: Any = None; self.channel: Any = None; self.realtime_channel: Any = None; self.events: Any = None; self.realtime: Any = None
        self.stop_event = asyncio.Event(); self.heartbeat_task: asyncio.Task[None] | None = None
        self.command_lock = asyncio.Lock()

    async def run(self) -> None:
        password = os.environ.get("RABBITMQ_DEFAULT_PASS")
        if not password: raise RuntimeError("RABBITMQ_DEFAULT_PASS is required")
        self.connection = await aio_pika.connect_robust(
            host=self.options.rabbit_host, port=self.options.rabbit_port,
            login=self.options.rabbit_user, password=password,
        )
        self.channel = await self.connection.channel(publisher_confirms=True); await self.channel.set_qos(prefetch_count=10)
        self.realtime_channel = await self.connection.channel(publisher_confirms=False)
        commands = await self.channel.declare_exchange("scarline.commands", aio_pika.ExchangeType.TOPIC, durable=True)
        self.events = await self.channel.declare_exchange("scarline.events", aio_pika.ExchangeType.TOPIC, durable=True)
        self.realtime = await self.realtime_channel.declare_exchange("scarline.realtime", aio_pika.ExchangeType.TOPIC, durable=True)
        await self.channel.declare_exchange("scarline.dlx", aio_pika.ExchangeType.TOPIC, durable=True)
        queue = await self.channel.declare_queue("scarline.io-client.commands", durable=True, arguments={"x-dead-letter-exchange":"scarline.dlx","x-dead-letter-routing-key":"dead.scarline.io-client.commands"})
        await queue.bind(commands, "commands.io-client.*")
        await queue.consume(self._delivery, no_ack=False)
        await self.publish_catalogue()
        self.heartbeat_task = asyncio.create_task(self._heartbeat())
        server = await asyncio.start_server(self._health, "127.0.0.1", self.options.health_port)
        LOGGER.info("IO Client ready as %s", self.instance_id)
        await self.stop_event.wait()
        server.close(); await server.wait_closed()
        if self.heartbeat_task: self.heartbeat_task.cancel()
        await self._stop_all(); await self.connection.close()

    async def _delivery(self, message: aio_pika.IncomingMessage) -> None:
        try:
            body = json.loads(message.body)
            async with self.command_lock:
                if body.get("routingKey") == "commands.io-client.catalogue-refresh":
                    self.manifests = load_manifests(Path(self.options.drivers_directory))
                    self.driver_types = discover_driver_types()
                    await self.publish_catalogue()
                elif str(body.get("routingKey", "")).startswith("commands.io-client.session-"): await self._lifecycle(body)
                else: raise ValueError("Unsupported IO Client command")
            await message.ack()
        except Exception:
            LOGGER.exception("IO command failed")
            if message.redelivered: await message.reject(requeue=False)
            else: await message.nack(requeue=True)

    async def _lifecycle(self, command: dict[str, Any]) -> None:
        data = command["payload"]; command_id = data["commandId"]
        existing = self.journal.get(command_id)
        if existing: await self._publish_ack(command, existing); return
        action = data["action"]; warning: str | None = None
        try:
            if action in {"start", "advance"}: warning = await self._activate(command, data["configuration"], advance=action == "advance")
            elif action == "pause": await self._pause(data["sessionId"])
            elif action == "resume": await self._resume(data["sessionId"])
            elif action in {"complete", "abort"}: await self._stop_session(data["sessionId"])
            else: raise ValueError(f"Unsupported lifecycle action: {action}")
            acknowledgement = {"commandId":command_id,"component":"io-client","status":"completed","error":None,"warning":warning}
        except Exception as error:
            try: await self._stop_session(data["sessionId"])
            except Exception: LOGGER.exception("IO Client cleanup failed after command error")
            acknowledgement = {"commandId":command_id,"component":"io-client","status":"failed","error":str(error)[:2000],"warning":None}
        self.journal.finish(command_id, acknowledgement); await self._publish_ack(command, acknowledgement)

    async def _activate(self, command: dict[str, Any], configuration: dict[str, Any], advance: bool) -> str | None:
        session_id = configuration["sessionId"]
        if advance: await self._stop_session(session_id)
        warnings: list[str] = []
        for device in configuration.get("devices", []):
            source_key = device["sourceKey"]
            lease = self.active.get(source_key)
            if lease and lease.session_id != session_id: raise RuntimeError(f"Device {source_key} is leased to another session")
            driver_type = self.driver_types.get(device["driverKey"])
            if driver_type is None:
                if device["required"]: raise RuntimeError(f"Required driver {device['driverKey']} is unavailable")
                warnings.append(f"Optional driver {device['driverKey']} is unavailable"); continue
            driver_configuration = dict(device.get("configuration", {}))
            if configuration.get("recording", {}).get("enabled") and driver_configuration.get("recording"):
                media_root = Path(configuration.get("recording", {}).get("directory") or self.options.media_directory)
                media_path = media_root / session_id / f"{device['assignmentId']}.mp4"
                driver_configuration["recordingPath"] = str(media_path)
            driver = driver_type(); await driver.configure(driver_configuration)
            try: await driver.connect(); await driver.start()
            except Exception as error:
                await driver.disconnect()
                if device["required"]: raise
                warnings.append(str(error)); continue
            active = ActiveDevice(session_id, configuration["studyId"], configuration["sessionConditionId"], device, driver)
            self.active[source_key] = active
            await self._publish_device_status(active, "connected", None)
            for sensor in device.get("sensors", []):
                if sensor.get("enabled", True): active.tasks.append(asyncio.create_task(self._samples(active, sensor)))
        return "; ".join(warnings) or None

    async def _samples(self, active: ActiveDevice, sensor: dict[str, Any]) -> None:
        rate = max(0.1, float(sensor.get("sampleRate", 1))); delay = 1 / rate; sequence = 0
        batch: list[dict[str, Any]] = []; first_timestamp = timestamp(); started = asyncio.get_running_loop().time()
        try:
            while active.driver.connected:
                if not active.driver.running:
                    await asyncio.sleep(min(delay, .05)); continue
                reading = await active.driver.read(sensor["key"])
                if reading:
                    if not batch: first_timestamp = reading.source_timestamp; started = asyncio.get_running_loop().time()
                    batch.append(reading.sample)
                    await self._publish_realtime_control(active, reading, sequence + len(batch) - 1)
                elapsed_ms = (asyncio.get_running_loop().time() - started) * 1000
                if batch and (len(batch) >= self.options.batch_max_samples or elapsed_ms >= self.options.batch_max_milliseconds):
                    payload = {"sessionConditionId":active.condition_id,"deviceId":active.device["deviceId"],"sensorId":sensor["sensorId"],"sourceKey":active.device["sourceKey"],"channelKey":sensor["key"],"sequenceStart":sequence,"sampleRate":rate,"sourceTimestamp":first_timestamp,"droppedSamples":reading.dropped_samples if reading else 0,"samples":batch}
                    await self.publish(envelope(f"events.{active.study_id}.{active.session_id}.{sensor.get('modality') or 'sensor'}.io.{sensor['key']}", payload, study_id=active.study_id, session_id=active.session_id, instance_id=self.instance_id))
                    sequence += len(batch); batch = []
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            LOGGER.exception("Sensor %s on %s disconnected", sensor["key"], active.device["sourceKey"])
            if active.failed: return
            active.failed = True
            await self._publish_device_status(active, "error", str(error)[:1000])
            await self.publish(envelope(
                f"events.{active.study_id}.{active.session_id}.error.sensor-disconnected",
                {"sourceKey": active.device["sourceKey"], "sensorId": sensor["sensorId"], "message": str(error)[:1000], "policy": active.device["onDisconnect"]},
                study_id=active.study_id, session_id=active.session_id, instance_id=self.instance_id,
            ))
            if active.device["onDisconnect"] == "fail":
                await self.publish(envelope(
                    f"events.{active.study_id}.{active.session_id}.lifecycle.session-fail",
                    {"action":"fail", "from":"running", "to":"failed", "reason":f"Required sensor {active.device['sourceKey']} disconnected: {error}"[:2000]},
                    study_id=active.study_id, session_id=active.session_id, instance_id=self.instance_id,
                ))

    async def _publish_realtime_control(self, active: ActiveDevice, reading: Reading, sequence: int) -> None:
        sample = reading.sample
        if not all(key in sample for key in ("steer", "throttle", "brake")): return
        if self.realtime is None: return
        control = {
            "version": 1,
            "id": str(uuid4()),
            "timestamp": reading.source_timestamp,
            "type": "vehicle.control",
            "studyId": active.study_id,
            "sessionId": active.session_id,
            "sessionConditionId": active.condition_id,
            "sourceKey": active.device["sourceKey"],
            "sequence": sequence,
            "throttle": max(0.0, min(1.0, float(sample["throttle"]))),
            "steer": max(-1.0, min(1.0, float(sample["steer"]))),
            "brake": max(0.0, min(1.0, float(sample["brake"]))),
        }
        body = json.dumps(control, separators=(",", ":")).encode()
        await self.realtime.publish(
            aio_pika.Message(body=body, content_type="application/json", delivery_mode=aio_pika.DeliveryMode.NOT_PERSISTENT, message_id=control["id"]),
            routing_key=f"controls.{active.session_id}",
        )

    async def _pause(self, session_id: str) -> None:
        for active in self.active.values():
            if active.session_id == session_id: await active.driver.pause()
    async def _resume(self, session_id: str) -> None:
        for active in self.active.values():
            if active.session_id == session_id: await active.driver.resume()
    async def _stop_session(self, session_id: str) -> None:
        for key, active in list(self.active.items()):
            if active.session_id != session_id: continue
            await active.driver.pause()
            for task in active.tasks: task.cancel()
            if active.tasks: await asyncio.gather(*active.tasks, return_exceptions=True)
            await active.driver.disconnect(); self.active.pop(key, None)
            resting_status = "connected" if active.device["driverKey"] == "mock" and self.options.mock_enabled else "disconnected"
            await self._publish_device_status(active, resting_status, None)
    async def _stop_all(self) -> None:
        for session_id in {item.session_id for item in self.active.values()}: await self._stop_session(session_id)

    async def publish_catalogue(self) -> None:
        for manifest in self.manifests.values():
            if manifest["mock"] and not self.options.mock_enabled: continue
            payload = {"sourceKey":f"driver:{manifest['key']}","driverKey":manifest["key"],"name":manifest["name"],"type":manifest["deviceType"],"status":"connected" if manifest["key"] == "mock" else "disconnected","metadata":{"version":manifest["version"],"platforms":manifest["platforms"],"capabilities":manifest["capabilities"]},"channels":manifest["channels"]}
            await self.publish(envelope("events.system.global.system.device.discovered", payload, instance_id=self.instance_id))

    async def _publish_device_status(self, active: ActiveDevice, status: str, message: str | None) -> None:
        await self.publish(envelope(
            "events.system.global.system.device.status",
            {"sourceKey":active.device["sourceKey"], "status":status, "message":message},
            instance_id=self.instance_id,
        ))

    async def _heartbeat(self) -> None:
        while True:
            await self.publish(envelope("events.system.global.system.component.heartbeat", {"status":"ready","adapters":list(self.manifests),"activeSessions":sorted({item.session_id for item in self.active.values()}),"checkedAt":timestamp()}, instance_id=self.instance_id))
            await asyncio.sleep(self.options.heartbeat_interval)

    async def _publish_ack(self, command: dict[str, Any], ack: dict[str, Any]) -> None:
        study_id = command["metadata"]["studyId"]; session_id = command["metadata"]["sessionId"]
        await self.publish(envelope(f"events.{study_id}.{session_id}.command.ack", ack, study_id=study_id, session_id=session_id, correlation_id=ack["commandId"], instance_id=self.instance_id))

    async def publish(self, value: dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        await self.events.publish(aio_pika.Message(body=body, content_type="application/json", delivery_mode=aio_pika.DeliveryMode.PERSISTENT, message_id=value["id"]), routing_key=value["routingKey"])

    async def _health(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(4096); body = json.dumps({"service":"io-client","status":"ready","instanceId":self.instance_id,"activeDrivers":len(self.active)}).encode()
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        await writer.drain(); writer.close(); await writer.wait_closed()

    def stop(self) -> None: self.stop_event.set()


def install_signal_handlers(host: IoHost) -> None:
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        try: loop.add_signal_handler(name, host.stop)
        except NotImplementedError: signal.signal(name, lambda *_: host.stop())

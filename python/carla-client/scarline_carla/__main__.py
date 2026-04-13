from __future__ import annotations

import asyncio
import json
import os
import time
import uuid

import websockets

try:  # pragma: no cover
    import carla  # type: ignore
except Exception:  # pragma: no cover
    carla = None


SIM_BRIDGE_URL = os.environ.get("SIM_BRIDGE_URL", "ws://sim-bridge:9000/adapter")
CARLA_SERVER_HOST = os.environ.get("CARLA_SERVER_HOST", "host.docker.internal")
CARLA_SERVER_PORT = int(os.environ.get("CARLA_SERVER_PORT", "2000"))


class CarlaAdapter:
    def __init__(self) -> None:
        self.client = None
        self.world = None
        self.study_id = None
        self.session_id = None
        self.paused = False
        self.pending_control = {"throttle": 0.0, "brake": 0.0, "steer": 0.0}
        if carla is not None:
            try:
                self.client = carla.Client(CARLA_SERVER_HOST, CARLA_SERVER_PORT)
                self.client.set_timeout(5.0)
                self.world = self.client.get_world()
            except Exception:
                self.client = None
                self.world = None

    async def send_event(self, socket, routing_key: str, data: dict, study_id: str | None, run_id: str | None) -> None:
        await socket.send(
            json.dumps(
                {
                    "version": "1.0",
                    "id": str(uuid.uuid4()),
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                    "type": "event",
                    "source": "carla-client",
                    "payload": {
                        "routingKey": routing_key,
                        "studyId": study_id,
                        "runId": run_id,
                        "data": data,
                    },
                }
            )
        )

    async def telemetry_loop(self, socket, study_id: str, run_id: str) -> None:
        tick = 0
        while self.session_id == run_id:
            if self.paused:
                await asyncio.sleep(0.05)
                continue

            if self.world is not None:
                try:
                    settings = self.world.get_settings()
                    settings.synchronous_mode = True
                    settings.fixed_delta_seconds = 0.05
                    self.world.apply_settings(settings)
                    self.world.tick()
                except Exception:
                    pass

            await self.send_event(
                socket,
                f"events.{study_id}.{run_id}.driving.vehicle.telemetry",
                {
                    "vehicle": {
                        "speed": round(self.pending_control["throttle"] * 120, 2),
                        "speedLimit": 50,
                        "acceleration": 1.0,
                        "position": {"x": tick * 0.25, "y": 0, "z": 0.5},
                        "rotation": {"pitch": 0, "yaw": tick % 360, "roll": 0},
                        "velocity": {"x": self.pending_control["throttle"] * 12, "y": 0, "z": 0},
                        "gear": 3,
                        "throttle": self.pending_control["throttle"],
                        "brake": self.pending_control["brake"],
                        "steer": self.pending_control["steer"],
                    }
                },
                study_id,
                run_id,
            )
            tick += 1
            await asyncio.sleep(0.05)

    async def send_response(self, socket, correlation_id: str | None, payload: dict) -> None:
        await socket.send(
            json.dumps(
                {
                    "version": "1.0",
                    "id": str(uuid.uuid4()),
                    "correlationId": correlation_id,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                    "type": "response",
                    "source": "carla-client",
                    "payload": payload,
                }
            )
        )


async def main() -> None:
    adapter = CarlaAdapter()
    async with websockets.connect(SIM_BRIDGE_URL) as socket:
        await socket.send(
            json.dumps(
                {
                    "version": "1.0",
                    "id": str(uuid.uuid4()),
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                    "type": "register",
                    "source": "carla-client",
                    "payload": {
                        "adapterId": "carla-client-1",
                        "simulatorType": "carla",
                        "simulatorVersion": "0.9.15",
                        "capabilities": [
                            "map-loading",
                            "weather-control",
                            "vehicle-spawning",
                            "sensor-management",
                            "traffic-management",
                            "recording",
                        ],
                        "status": "ready" if adapter.world is not None else "degraded",
                    },
                }
            )
        )

        telemetry_task = None
        async for message in socket:
            payload = json.loads(message)
            if payload.get("type") != "command":
                continue

            action = payload["payload"].get("action")
            session_id = payload["payload"].get("sessionId")
            study_id = payload["payload"].get("studyId")
            correlation_id = payload.get("id")

            if action == "bind-session" and session_id and study_id:
                adapter.study_id = study_id
                adapter.session_id = session_id
                adapter.paused = False
                if telemetry_task is None or telemetry_task.done():
                    telemetry_task = asyncio.create_task(adapter.telemetry_loop(socket, study_id, session_id))
                await adapter.send_response(
                    socket,
                    correlation_id,
                    {
                        "success": True,
                        "accepted": True,
                        "sessionId": session_id,
                        "activeSessionId": session_id,
                        "simulatorType": "carla",
                    },
                )
                continue

            if action == "unbind-session":
                released_session = adapter.session_id
                adapter.session_id = None
                adapter.study_id = None
                adapter.paused = False
                if telemetry_task is not None:
                    telemetry_task.cancel()
                    try:
                        await telemetry_task
                    except asyncio.CancelledError:
                        pass
                    telemetry_task = None
                await adapter.send_response(
                    socket,
                    correlation_id,
                    {
                        "success": True,
                        "accepted": True,
                        "sessionId": released_session,
                        "activeSessionId": None,
                        "simulatorType": "carla",
                    },
                )
                continue

            if action == "pause-session":
                adapter.paused = True
                await adapter.send_response(socket, correlation_id, {"success": True, "sessionId": adapter.session_id, "activeSessionId": adapter.session_id})
                continue

            if action == "resume-session":
                adapter.paused = False
                await adapter.send_response(socket, correlation_id, {"success": True, "sessionId": adapter.session_id, "activeSessionId": adapter.session_id})
                continue

            if action in {"load-map", "set-weather", "spawn-vehicle", "configure-sensors", "set-traffic"} and session_id and study_id:
                if telemetry_task is None or telemetry_task.done():
                    telemetry_task = asyncio.create_task(adapter.telemetry_loop(socket, study_id, session_id))
                await adapter.send_response(socket, correlation_id, {"success": True, "sessionId": session_id, "activeSessionId": session_id})
                continue

            if action == "apply-control":
                adapter.pending_control = {
                    "throttle": float(payload["payload"].get("throttle", 0)),
                    "brake": float(payload["payload"].get("brake", 0)),
                    "steer": float(payload["payload"].get("steer", 0)),
                }
                await adapter.send_response(socket, correlation_id, {"success": True, "sessionId": adapter.session_id, "activeSessionId": adapter.session_id})
                continue

            await adapter.send_response(
                socket,
                correlation_id,
                {
                    "success": False,
                    "accepted": False,
                    "error": f"unsupported_action:{action}",
                    "sessionId": adapter.session_id,
                    "activeSessionId": adapter.session_id,
                },
            )


if __name__ == "__main__":
    asyncio.run(main())

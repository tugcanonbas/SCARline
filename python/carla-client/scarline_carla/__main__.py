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


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


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
                    "timestamp": iso_timestamp(),
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
                    "timestamp": iso_timestamp(),
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

            if tick % 20 == 0:
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.world.snapshot",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": tick,
                        "simulationTime": round(tick * 0.05, 2),
                        "deltaSeconds": 0.05,
                        "weather": {"preset": "ClearNoon"},
                        "actorCount": 1,
                        "map": "CARLA",
                        "source": "carla-client-stub",
                    },
                    study_id,
                    run_id,
                )

            if tick > 0 and tick % 400 == 0:
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.vehicle.lane_invasion",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": tick,
                        "crossedMarkings": [{"type": "Broken", "color": "White", "laneChange": "Both"}],
                        "source": "carla-client-stub",
                    },
                    study_id,
                    run_id,
                )

            if tick > 0 and tick % 1200 == 0:
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.vehicle.collision",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": tick,
                        "otherActor": {"id": 0, "type": "stub", "blueprint": "static.stub"},
                        "impulse": {"x": 0, "y": 0, "z": 0},
                        "source": "carla-client-stub",
                    },
                    study_id,
                    run_id,
                )

            if tick % 20 == 0:
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.sensor.camera",
                    {
                        "timestamp": iso_timestamp(),
                        "sensorId": "front_rgb",
                        "frame": tick,
                        "width": 1920,
                        "height": 1080,
                        "encoding": "reference",
                        "dataRef": f"carla://{run_id}/front_rgb/{tick:06d}",
                    },
                    study_id,
                    run_id,
                )

            if tick % 10 == 0:
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.sensor.gnss",
                    {
                        "timestamp": iso_timestamp(),
                        "sensorId": "gnss",
                        "frame": tick,
                        "latitude": 52.0 + tick * 0.000001,
                        "longitude": 13.0,
                        "altitude": 35.0,
                    },
                    study_id,
                    run_id,
                )
                await self.send_event(
                    socket,
                    f"events.{study_id}.{run_id}.driving.sensor.imu",
                    {
                        "timestamp": iso_timestamp(),
                        "sensorId": "imu",
                        "frame": tick,
                        "accelerometer": {"x": self.pending_control["throttle"], "y": 0, "z": 9.81},
                        "gyroscope": {"x": 0, "y": 0, "z": self.pending_control["steer"]},
                        "compass": float(tick % 360),
                    },
                    study_id,
                    run_id,
                )
            tick += 1
            await asyncio.sleep(0.05)

    async def heartbeat_loop(self, socket) -> None:
        while True:
            await socket.send(
                json.dumps(
                    {
                        "version": "1.0",
                        "id": str(uuid.uuid4()),
                        "timestamp": iso_timestamp(),
                        "type": "heartbeat",
                        "source": "carla-client",
                        "payload": {
                            "activeSession": self.session_id,
                            "carlaConnected": self.world is not None,
                            "status": "ready" if self.world is not None else "degraded",
                        },
                    }
                )
            )
            await asyncio.sleep(10)

    async def send_response(self, socket, correlation_id: str | None, payload: dict) -> None:
        await socket.send(
            json.dumps(
                {
                    "version": "1.0",
                    "id": str(uuid.uuid4()),
                    "correlationId": correlation_id,
                    "timestamp": iso_timestamp(),
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
                    "timestamp": iso_timestamp(),
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
                            "world-snapshot",
                            "collision-events",
                            "lane-invasion-events",
                            "camera-reference",
                            "gnss",
                            "imu",
                        ],
                        "status": "ready" if adapter.world is not None else "degraded",
                    },
                }
            )
        )

        telemetry_task = None
        heartbeat_task = asyncio.create_task(adapter.heartbeat_loop(socket))
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

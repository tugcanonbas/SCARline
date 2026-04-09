from __future__ import annotations

import asyncio
import json
import math
import os
import time
import uuid

import websockets


SIM_BRIDGE_URL = os.environ.get("SIM_BRIDGE_URL", "ws://sim-bridge:9000/adapter")


async def send_event(socket, routing_key: str, data: dict, study_id: str | None, run_id: str | None) -> None:
    await socket.send(
        json.dumps(
            {
                "version": "1.0",
                "id": str(uuid.uuid4()),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "type": "event",
                "source": "mock-simulator",
                "payload": {
                    "routingKey": routing_key,
                    "studyId": study_id,
                    "runId": run_id,
                    "data": data,
                },
            }
        )
    )


async def telemetry_loop(socket, study_id: str, run_id: str) -> None:
    tick = 0
    while True:
        speed = round(50 + math.sin(tick / 10) * 25, 2)
        await send_event(
            socket,
            f"events.{study_id}.{run_id}.driving.vehicle.telemetry",
            {
                "vehicle": {
                    "speed": speed,
                    "speedLimit": 50,
                    "acceleration": 1.1,
                    "position": {"x": tick * 0.5, "y": 0, "z": 0.5},
                    "rotation": {"pitch": 0, "yaw": tick % 360, "roll": 0},
                    "velocity": {"x": speed / 3.6, "y": 0, "z": 0},
                    "gear": 3,
                    "throttle": 0.5,
                    "brake": 0,
                    "steer": round(math.sin(tick / 20) * 0.2, 3),
                }
            },
            study_id,
            run_id,
        )

        if tick % 20 == 0:
            await send_event(
                socket,
                f"events.{study_id}.{run_id}.driving.world.snapshot",
                {
                    "frame": tick,
                    "simulationTime": round(tick * 0.05, 2),
                    "deltaSeconds": 0.05,
                    "weather": {"cloudiness": 20, "precipitation": 0},
                    "actorCount": 10,
                },
                study_id,
                run_id,
            )
        tick += 1
        await asyncio.sleep(0.05)


async def main() -> None:
    async with websockets.connect(SIM_BRIDGE_URL) as socket:
        await socket.send(
            json.dumps(
                {
                    "version": "1.0",
                    "id": str(uuid.uuid4()),
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                    "type": "register",
                    "source": "mock-simulator",
                    "payload": {
                        "adapterId": "mock-simulator-1",
                        "simulatorType": "mock",
                        "simulatorVersion": "0.1.0",
                        "capabilities": [
                            "map-loading",
                            "weather-control",
                            "vehicle-spawning",
                            "sensor-management",
                            "traffic-management",
                        ],
                        "status": "ready",
                    },
                }
            )
        )

        task = None
        async for message in socket:
            payload = json.loads(message)
            if payload.get("type") != "command":
                continue
            action = payload["payload"].get("action")
            session_id = payload["payload"].get("sessionId")
            study_id = payload["payload"].get("studyId")
            if action in {"load-map", "set-weather", "spawn-vehicle", "configure-sensors", "set-traffic"} and session_id and study_id:
                if task is None or task.done():
                    task = asyncio.create_task(telemetry_loop(socket, study_id, session_id))
            if action == "apply-control":
                await send_event(
                    socket,
                    f"events.{study_id}.{session_id}.driving.vehicle.telemetry",
                    {
                        "vehicle": {
                            "speed": round((payload["payload"].get("throttle", 0) * 120), 2),
                            "speedLimit": 50,
                            "throttle": payload["payload"].get("throttle", 0),
                            "brake": payload["payload"].get("brake", 0),
                            "steer": payload["payload"].get("steer", 0),
                        }
                    },
                    study_id,
                    session_id,
                )


if __name__ == "__main__":
    asyncio.run(main())

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import time
import uuid
from dataclasses import dataclass, field

import websockets


SIM_BRIDGE_URL = os.environ.get("SIM_BRIDGE_URL", "ws://sim-bridge:9000/adapter")
DEFAULT_SCENARIO = os.environ.get("MOCK_SCENARIO", "city_drive")
TELEMETRY_RATE = max(int(os.environ.get("MOCK_TELEMETRY_RATE", "20")), 1)
RECONNECT_DELAY_SECONDS = max(float(os.environ.get("MOCK_RECONNECT_DELAY", "2")), 0.5)


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


@dataclass
class MockSessionState:
    scenario: str = DEFAULT_SCENARIO
    study_id: str | None = None
    session_id: str | None = None
    map_name: str = "MockTown01"
    weather: dict = field(default_factory=lambda: {"preset": "ClearNoon", "custom": {}})
    traffic: dict = field(default_factory=dict)
    sensors: list[dict] = field(default_factory=list)
    controls: dict = field(default_factory=lambda: {"throttle": 0.45, "brake": 0.0, "steer": 0.0})
    paused: bool = False
    tick: int = 0


async def send_message(socket, message_type: str, payload: dict, *, correlation_id: str | None = None) -> None:
    await socket.send(
        json.dumps(
            {
                "version": "1.0",
                "id": str(uuid.uuid4()),
                "correlationId": correlation_id,
                "timestamp": iso_timestamp(),
                "type": message_type,
                "source": "mock-simulator",
                "payload": payload,
            }
        )
    )


async def send_event(socket, routing_key: str, data: dict, study_id: str | None, run_id: str | None) -> None:
    await send_message(
        socket,
        "event",
        {
            "routingKey": routing_key,
            "studyId": study_id,
            "runId": run_id,
            "data": data,
        },
    )


async def send_response(socket, correlation_id: str | None, payload: dict) -> None:
    await send_message(socket, "response", payload, correlation_id=correlation_id)


async def heartbeat_loop(socket, state: MockSessionState) -> None:
    while True:
        await send_message(
            socket,
            "heartbeat",
            {
                "uptime": int(time.monotonic()),
                "memoryUsage": 64,
                "activeSession": state.session_id,
            },
        )
        await asyncio.sleep(10)


def current_speed(state: MockSessionState) -> float:
    if state.controls["brake"] > 0:
        return round(max(0.0, 25.0 - (state.controls["brake"] * 80.0)), 2)

    throttle_speed = state.controls["throttle"] * 120.0
    oscillation = math.sin(state.tick / 10) * 8.0
    return round(max(0.0, throttle_speed + oscillation), 2)


async def telemetry_loop(socket, state: MockSessionState) -> None:
    delay = 1 / TELEMETRY_RATE

    while state.session_id and state.study_id:
        if state.paused:
            await asyncio.sleep(delay)
            continue

        speed = current_speed(state)
        yaw = state.tick % 360

        await send_event(
            socket,
            f"events.{state.study_id}.{state.session_id}.driving.vehicle.telemetry",
            {
                "vehicle": {
                    "speed": speed,
                    "speedLimit": 50,
                    "acceleration": round(state.controls["throttle"] * 2.4, 2),
                    "position": {"x": round(state.tick * 0.5, 2), "y": 0, "z": 0.5},
                    "rotation": {"pitch": 0, "yaw": yaw, "roll": 0},
                    "velocity": {"x": round(speed / 3.6, 3), "y": 0, "z": 0},
                    "gear": 3,
                    "throttle": state.controls["throttle"],
                    "brake": state.controls["brake"],
                    "steer": state.controls["steer"],
                }
            },
            state.study_id,
            state.session_id,
        )

        if state.tick % TELEMETRY_RATE == 0:
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.world.snapshot",
                {
                    "frame": state.tick,
                    "simulationTime": round(state.tick * delay, 2),
                    "deltaSeconds": round(delay, 3),
                    "weather": state.weather,
                    "actorCount": int(state.traffic.get("npcCount", 10)),
                    "map": state.map_name,
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )

        state.tick += 1
        await asyncio.sleep(delay)


async def stop_telemetry(task: asyncio.Task | None) -> None:
    if task is None:
        return

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def run_connection(state: MockSessionState) -> None:
    async with websockets.connect(SIM_BRIDGE_URL) as socket:
        print(f"mock-simulator connected to {SIM_BRIDGE_URL}", flush=True)
        await send_message(
            socket,
            "register",
            {
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
        )

        heartbeat_task = asyncio.create_task(heartbeat_loop(socket, state))
        telemetry_task: asyncio.Task | None = None

        try:
            async for message in socket:
                envelope = json.loads(message)
                if envelope.get("type") != "command":
                    continue

                correlation_id = envelope.get("id")
                payload = envelope.get("payload", {})
                action = payload.get("action")

                if action == "bind-session":
                    await stop_telemetry(telemetry_task)
                    state.study_id = payload.get("studyId")
                    state.session_id = payload.get("sessionId")
                    config = payload.get("config", {})
                    state.map_name = config.get("map", "MockTown01")
                    state.weather = config.get("weather", {"preset": "ClearNoon", "custom": {}})
                    state.traffic = config.get("traffic", {})
                    state.sensors = config.get("sensors", [])
                    state.controls = {"throttle": 0.45, "brake": 0.0, "steer": 0.0}
                    state.paused = False
                    state.tick = 0
                    telemetry_task = asyncio.create_task(telemetry_loop(socket, state))
                    await send_response(
                        socket,
                        correlation_id,
                        {
                            "success": True,
                            "accepted": True,
                            "sessionId": state.session_id,
                            "activeSessionId": state.session_id,
                        },
                    )
                    continue

                if action == "unbind-session":
                    released_session = state.session_id
                    await stop_telemetry(telemetry_task)
                    telemetry_task = None
                    state.session_id = None
                    state.study_id = None
                    state.paused = False
                    await send_response(
                        socket,
                        correlation_id,
                        {
                            "success": True,
                            "accepted": True,
                            "sessionId": released_session,
                            "activeSessionId": None,
                        },
                    )
                    continue

                if action == "pause-session":
                    state.paused = True
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "resume-session":
                    state.paused = False
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "load-map":
                    state.map_name = payload.get("mapName", state.map_name)
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "set-weather":
                    state.weather = {
                        "preset": payload.get("preset", state.weather.get("preset", "ClearNoon")),
                        "custom": payload.get("custom", {}),
                    }
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "configure-sensors":
                    state.sensors = payload.get("sensors", [])
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "set-traffic":
                    state.traffic = payload
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                if action == "apply-control" and state.session_id and state.study_id:
                    state.controls = {
                        "throttle": float(payload.get("throttle", state.controls["throttle"])),
                        "brake": float(payload.get("brake", state.controls["brake"])),
                        "steer": float(payload.get("steer", state.controls["steer"])),
                    }
                    await send_event(
                        socket,
                        f"events.{state.study_id}.{state.session_id}.driving.vehicle.telemetry",
                        {
                            "vehicle": {
                                "speed": current_speed(state),
                                "speedLimit": 50,
                                "throttle": state.controls["throttle"],
                                "brake": state.controls["brake"],
                                "steer": state.controls["steer"],
                            }
                        },
                        state.study_id,
                        state.session_id,
                    )
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id})
                    continue

                await send_response(
                    socket,
                    correlation_id,
                    {
                        "success": False,
                        "sessionId": state.session_id,
                        "activeSessionId": state.session_id,
                        "error": f"unsupported_action:{action}",
                    },
                )
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            await stop_telemetry(telemetry_task)


async def main() -> None:
    while True:
        state = MockSessionState()
        try:
            await run_connection(state)
            print("mock-simulator disconnected; reconnecting", flush=True)
        except Exception as error:
            print(f"mock-simulator connection error: {error}", flush=True)

        await asyncio.sleep(RECONNECT_DELAY_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())

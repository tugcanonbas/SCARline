from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import random
import time
import uuid
from pathlib import Path
from dataclasses import dataclass, field

import websockets
import yaml


SIM_BRIDGE_URL = os.environ.get("SIM_BRIDGE_URL", "ws://sim-bridge:9000/adapter")
DEFAULT_SCENARIO = os.environ.get("MOCK_SCENARIO", "city_drive")
SCENARIO_CATALOGUE_PATH = Path(os.environ.get("MOCK_SCENARIO_CATALOGUE", "scenarios.yaml"))
TELEMETRY_RATE = max(int(os.environ.get("MOCK_TELEMETRY_RATE", "20")), 1)
RECONNECT_DELAY_SECONDS = max(float(os.environ.get("MOCK_RECONNECT_DELAY", "2")), 0.5)

DEFAULT_SCENARIOS: dict[str, dict] = {
    "city_drive": {
        "map": "MockTown01",
        "speedLimit": 50,
        "baseThrottle": 0.45,
        "speedOscillation": 8.0,
        "traffic": {"npcCount": 12},
        "events": {"laneInvasionEveryTicks": 0, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 101,
    },
    "highway": {
        "map": "MockHighway01",
        "speedLimit": 100,
        "baseThrottle": 0.72,
        "speedOscillation": 12.0,
        "traffic": {"npcCount": 26},
        "events": {"laneInvasionEveryTicks": 160, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 202,
    },
    "parking": {
        "map": "MockParking01",
        "speedLimit": 15,
        "baseThrottle": 0.18,
        "speedOscillation": 2.0,
        "traffic": {"npcCount": 2},
        "events": {"laneInvasionEveryTicks": 0, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 303,
    },
    "stop_go": {
        "map": "MockTownStopGo",
        "speedLimit": 35,
        "baseThrottle": 0.38,
        "speedOscillation": 18.0,
        "traffic": {"npcCount": 18, "stopGo": True},
        "events": {"laneInvasionEveryTicks": 90, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 404,
    },
}


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


@dataclass
class MockSessionState:
    scenario_catalogue: dict[str, dict] = field(default_factory=dict)
    scenario_config: dict = field(default_factory=dict)
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
    rng: random.Random = field(default_factory=random.Random)


def load_scenario_catalogue(path: Path) -> dict[str, dict]:
    if not path.exists():
        return DEFAULT_SCENARIOS

    with path.open("r", encoding="utf-8") as handle:
        parsed = yaml.safe_load(handle) or {}

    scenarios = parsed.get("scenarios", parsed)
    if not isinstance(scenarios, dict):
        raise ValueError("Mock scenario catalogue must be a mapping or contain a scenarios mapping")

    catalogue = DEFAULT_SCENARIOS.copy()
    for name, config in scenarios.items():
        if isinstance(name, str) and isinstance(config, dict):
            catalogue[name] = {**catalogue.get(name, {}), **config}

    return catalogue


def select_scenario(state: MockSessionState, requested: str | None) -> dict:
    scenario_name = requested or DEFAULT_SCENARIO
    if scenario_name not in state.scenario_catalogue:
        scenario_name = DEFAULT_SCENARIO if DEFAULT_SCENARIO in state.scenario_catalogue else "city_drive"

    scenario = state.scenario_catalogue.get(scenario_name, DEFAULT_SCENARIOS["city_drive"])
    state.scenario = scenario_name
    state.scenario_config = scenario
    seed = int(os.environ.get("MOCK_SCENARIO_SEED", scenario.get("seed", 42)))
    session_offset = sum(ord(char) for char in str(state.session_id or ""))
    state.rng.seed(seed + session_offset)
    return scenario


def scenario_events(state: MockSessionState) -> dict:
    events = state.scenario_config.get("events", {})
    return events if isinstance(events, dict) else {}


def should_emit_every(state: MockSessionState, key: str) -> bool:
    every = int(scenario_events(state).get(key, 0) or 0)
    return every > 0 and state.tick > 0 and state.tick % every == 0


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
        speed_limit = float(state.scenario_config.get("speedLimit", 50))
        return round(max(0.0, min(speed_limit, 25.0) - (state.controls["brake"] * 80.0)), 2)

    speed_limit = float(state.scenario_config.get("speedLimit", 50))
    speed_oscillation = float(state.scenario_config.get("speedOscillation", 8.0))
    throttle_speed = state.controls["throttle"] * max(speed_limit * 1.2, 1.0)
    oscillation = math.sin(state.tick / 10) * speed_oscillation
    return round(max(0.0, min(speed_limit * 1.15, throttle_speed + oscillation)), 2)


async def telemetry_loop(socket, state: MockSessionState) -> None:
    delay = 1 / TELEMETRY_RATE

    while state.session_id and state.study_id:
        if state.paused:
            await asyncio.sleep(delay)
            continue

        speed = current_speed(state)
        yaw = state.tick % 360
        speed_limit = float(state.scenario_config.get("speedLimit", 50))

        await send_event(
            socket,
            f"events.{state.study_id}.{state.session_id}.driving.vehicle.telemetry",
            {
                "vehicle": {
                    "speed": speed,
                    "speedLimit": speed_limit,
                    "acceleration": round(state.controls["throttle"] * 2.4, 2),
                    "position": {
                        "x": round(state.tick * max(speed, 1.0) / (TELEMETRY_RATE * 3.6), 2),
                        "y": round(math.sin(state.tick / 18) * state.controls["steer"], 3),
                        "z": 0.5,
                    },
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

        if should_emit_every(state, "laneInvasionEveryTicks"):
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.vehicle.lane_invasion",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "crossedMarkings": [
                        {
                            "type": state.rng.choice(["Solid", "Broken", "Curb"]),
                            "color": "White",
                            "laneChange": state.rng.choice(["None", "Left", "Right", "Both"]),
                        }
                    ],
                    "severity": state.rng.choice(["low", "medium"]),
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )

        if should_emit_every(state, "collisionEveryTicks"):
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.vehicle.collision",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "otherActor": {
                        "id": state.rng.randint(100, 999),
                        "type": state.rng.choice(["vehicle", "static", "walker"]),
                        "blueprint": state.rng.choice(["vehicle.mock.audi", "static.traffic_cone", "walker.pedestrian.mock"]),
                    },
                    "impulse": {
                        "x": round(state.rng.uniform(0.8, 4.5), 2),
                        "y": round(state.rng.uniform(-1.0, 1.0), 2),
                        "z": 0,
                    },
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )

        if should_emit_every(state, "cameraEveryTicks") and state.sensors:
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.sensor.camera",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "sensorId": "mock-camera-front",
                    "dataRef": f"mock://{state.session_id}/camera/front/{state.tick:06d}.jpg",
                    "width": 1280,
                    "height": 720,
                    "encoding": "reference",
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )

        if state.tick % max(TELEMETRY_RATE // 2, 1) == 0 and state.sensors:
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.sensor.gnss",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "sensorId": "mock-gnss",
                    "latitude": 52.0 + state.tick * 0.000001,
                    "longitude": 13.0 + math.sin(state.tick / 100) * 0.0001,
                    "altitude": 34.0,
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.sensor.imu",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "sensorId": "mock-imu",
                    "accelerometer": {"x": round(state.controls["throttle"] * 2.4, 2), "y": 0, "z": 9.81},
                    "gyroscope": {"x": 0, "y": 0, "z": round(state.controls["steer"], 3)},
                    "compass": float(yaw),
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )

        if state.tick % TELEMETRY_RATE == 0:
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.world.snapshot",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "simulationTime": round(state.tick * delay, 2),
                    "deltaSeconds": round(delay, 3),
                    "weather": state.weather,
                    "actorCount": int(state.traffic.get("npcCount", 10)),
                    "map": state.map_name,
                    "scenario": state.scenario,
                    "seeded": True,
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
                    scenario = select_scenario(state, config.get("scenario") or payload.get("scenario"))
                    state.map_name = config.get("map", scenario.get("map", "MockTown01"))
                    state.weather = config.get("weather", {"preset": "ClearNoon", "custom": {}})
                    state.traffic = {**scenario.get("traffic", {}), **config.get("traffic", {})}
                    state.sensors = config.get("sensors", [])
                    state.controls = {"throttle": float(scenario.get("baseThrottle", 0.45)), "brake": 0.0, "steer": 0.0}
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
                            "scenario": state.scenario,
                            "map": state.map_name,
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
                                "speedLimit": float(state.scenario_config.get("speedLimit", 50)),
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
    scenario_catalogue = load_scenario_catalogue(SCENARIO_CATALOGUE_PATH)
    while True:
        state = MockSessionState(scenario_catalogue=scenario_catalogue)
        try:
            await run_connection(state)
            print("mock-simulator disconnected; reconnecting", flush=True)
        except Exception as error:
            print(f"mock-simulator connection error: {error}", flush=True)

        await asyncio.sleep(RECONNECT_DELAY_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())

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
HEALTH_PORT = max(int(os.environ.get("MOCK_HEALTH_PORT", "8082")), 1)

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
    "highway_cruise": {
        "map": "MockHighway01",
        "speedLimit": 120,
        "baseThrottle": 0.76,
        "speedOscillation": 14.0,
        "traffic": {"npcCount": 28},
        "events": {"laneInvasionEveryTicks": 140, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 202,
    },
    "rainy_city": {
        "map": "MockTownRain",
        "speedLimit": 45,
        "baseThrottle": 0.4,
        "speedOscillation": 7.0,
        "weather": {"preset": "WetCloudyNoon", "custom": {"precipitation": 65, "wetness": 85}},
        "traffic": {"npcCount": 14, "pedestrianCount": 8},
        "events": {"laneInvasionEveryTicks": 100, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 606,
    },
    "night_drive": {
        "map": "MockHighwayNight",
        "speedLimit": 95,
        "baseThrottle": 0.62,
        "speedOscillation": 10.0,
        "weather": {"preset": "ClearNight", "custom": {"sunAltitudeAngle": -30}},
        "traffic": {"npcCount": 18},
        "events": {"laneInvasionEveryTicks": 150, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 707,
    },
    "stop_and_go": {
        "map": "MockTownStopGo",
        "speedLimit": 35,
        "baseThrottle": 0.38,
        "speedOscillation": 18.0,
        "traffic": {"npcCount": 18, "stopGo": True},
        "events": {"laneInvasionEveryTicks": 90, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 404,
    },
    "parking_scenario": {
        "map": "MockParking01",
        "speedLimit": 10,
        "baseThrottle": 0.12,
        "speedOscillation": 1.5,
        "traffic": {"npcCount": 1, "pedestrianCount": 4},
        "events": {"laneInvasionEveryTicks": 0, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 303,
    },
    "sensor_test": {
        "map": "MockSensorRig",
        "speedLimit": 0,
        "baseThrottle": 0.0,
        "speedOscillation": 0.0,
        "traffic": {"npcCount": 0},
        "events": {"laneInvasionEveryTicks": 0, "collisionEveryTicks": 0, "cameraEveryTicks": 10},
        "seed": 808,
    },
    "widget_test": {
        "map": "MockWidgetLoop",
        "speedLimit": 80,
        "baseThrottle": 0.58,
        "speedOscillation": 25.0,
        "traffic": {"npcCount": 10},
        "events": {"laneInvasionEveryTicks": 60, "collisionEveryTicks": 180, "cameraEveryTicks": 10},
        "seed": 909,
    },
    "stress_test": {
        "map": "MockStressTrack",
        "speedLimit": 130,
        "baseThrottle": 0.82,
        "speedOscillation": 30.0,
        "traffic": {"npcCount": 40, "pedestrianCount": 20},
        "events": {"laneInvasionEveryTicks": 40, "collisionEveryTicks": 120, "cameraEveryTicks": 5},
        "seed": 1001,
    },
    "custom_template": {
        "map": "MockTown01",
        "speedLimit": 50,
        "baseThrottle": 0.45,
        "speedOscillation": 8.0,
        "traffic": {"npcCount": 0},
        "events": {"laneInvasionEveryTicks": 0, "collisionEveryTicks": 0, "cameraEveryTicks": 20},
        "seed": 42,
    },
}


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


HEALTH_STATE: dict[str, object] = {
    "status": "starting",
    "startedAt": iso_timestamp(),
    "bridgeConnected": False,
    "activeSessionId": None,
    "activeSession": None,
    "scenario": DEFAULT_SCENARIO,
    "scenarioCount": 0,
    "simulationTime": 0.0,
    "telemetryRate": TELEMETRY_RATE,
}


def update_health(**values: object) -> None:
    HEALTH_STATE.update(values)
    HEALTH_STATE["checkedAt"] = iso_timestamp()


async def handle_health_request(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    request_line = await reader.readline()
    parts = request_line.decode("utf8", errors="ignore").split()
    path = parts[1] if len(parts) >= 2 else "/"

    while True:
        line = await reader.readline()
        if line in {b"\r\n", b"\n", b""}:
            break

    status_code = 200 if path in {"/", "/health"} else 404
    body = json.dumps(HEALTH_STATE | {"service": "mock-simulator"}).encode("utf8")
    reason = "OK" if status_code == 200 else "Not Found"
    headers = (
        f"HTTP/1.1 {status_code} {reason}\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(headers.encode("utf8") + body)
    await writer.drain()
    writer.close()
    await writer.wait_closed()


async def health_server() -> None:
    server = await asyncio.start_server(handle_health_request, "0.0.0.0", HEALTH_PORT)
    async with server:
        await server.serve_forever()


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
    ego_vehicle: dict = field(default_factory=dict)
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


def normalized_sensor_type(sensor: dict) -> str:
    sensor_type = sensor.get("type") or sensor.get("sensorType") or ""
    return str(sensor_type).lower()


def sensor_matches(sensor: dict, *needles: str) -> bool:
    sensor_type = normalized_sensor_type(sensor)
    return any(needle in sensor_type for needle in needles)


def configured_sensor(state: MockSessionState, *needles: str) -> dict | None:
    for sensor in state.sensors:
        if isinstance(sensor, dict) and sensor_matches(sensor, *needles):
            return sensor
    return None


def sensor_id(sensor: dict | None, fallback: str) -> str:
    if not sensor:
        return fallback
    return str(sensor.get("id") or sensor.get("sensorId") or fallback)


def sensor_attributes(sensor: dict | None) -> dict:
    attributes = sensor.get("attributes") if isinstance(sensor, dict) else None
    return attributes if isinstance(attributes, dict) else {}


def attribute_number(attributes: dict, key: str, default: float) -> float:
    value = attributes.get(key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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
        simulation_time = round(state.tick * delay, 2)
        update_health(
            status="running",
            activeSessionId=state.session_id,
            activeSession=state.session_id,
            scenario=state.scenario,
            simulationTime=simulation_time,
        )

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
            rgb_camera = configured_sensor(state, "camera.rgb", "camera")
            depth_camera = configured_sensor(state, "camera.depth", "depth")
            await send_event(
                socket,
                f"events.{state.study_id}.{state.session_id}.driving.sensor.camera",
                {
                    "timestamp": iso_timestamp(),
                    "frame": state.tick,
                    "sensorId": sensor_id(rgb_camera, "mock-camera-front"),
                    "dataRef": f"mock://{state.session_id}/camera/front/{state.tick:06d}.jpg",
                    "width": int(attribute_number(sensor_attributes(rgb_camera), "image_size_x", 1280)),
                    "height": int(attribute_number(sensor_attributes(rgb_camera), "image_size_y", 720)),
                    "encoding": "reference",
                    "scenario": state.scenario,
                },
                state.study_id,
                state.session_id,
            )
            if depth_camera:
                await send_event(
                    socket,
                    f"events.{state.study_id}.{state.session_id}.driving.sensor.depth",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": state.tick,
                        "sensorId": sensor_id(depth_camera, "mock-depth-front"),
                        "dataRef": f"mock://{state.session_id}/camera/depth/{state.tick:06d}.bin",
                        "width": int(attribute_number(sensor_attributes(depth_camera), "image_size_x", 1280)),
                        "height": int(attribute_number(sensor_attributes(depth_camera), "image_size_y", 720)),
                        "encoding": "reference",
                        "scenario": state.scenario,
                    },
                    state.study_id,
                    state.session_id,
                )

        if state.tick % max(TELEMETRY_RATE // 2, 1) == 0 and state.sensors:
            lidar = configured_sensor(state, "lidar")
            radar = configured_sensor(state, "radar")
            gnss = configured_sensor(state, "gnss")
            imu = configured_sensor(state, "imu")

            if lidar:
                await send_event(
                    socket,
                    f"events.{state.study_id}.{state.session_id}.driving.sensor.lidar",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": state.tick,
                        "sensorId": sensor_id(lidar, "mock-lidar-roof"),
                        "dataRef": f"mock://{state.session_id}/lidar/{state.tick:06d}.pcd",
                        "pointCount": int(attribute_number(sensor_attributes(lidar), "points_per_second", 120000) / TELEMETRY_RATE),
                        "range": attribute_number(sensor_attributes(lidar), "range", 85),
                        "scenario": state.scenario,
                    },
                    state.study_id,
                    state.session_id,
                )

            if radar:
                await send_event(
                    socket,
                    f"events.{state.study_id}.{state.session_id}.driving.sensor.radar",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": state.tick,
                        "sensorId": sensor_id(radar, "mock-radar-front"),
                        "detections": [
                            {
                                "depth": round(state.rng.uniform(6.0, 45.0), 2),
                                "velocity": round(state.rng.uniform(-8.0, 4.0), 2),
                                "azimuth": round(state.rng.uniform(-0.35, 0.35), 3),
                                "altitude": round(state.rng.uniform(-0.08, 0.08), 3),
                            }
                            for _ in range(3)
                        ],
                        "scenario": state.scenario,
                    },
                    state.study_id,
                    state.session_id,
                )

            if gnss:
                await send_event(
                    socket,
                    f"events.{state.study_id}.{state.session_id}.driving.sensor.gnss",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": state.tick,
                        "sensorId": sensor_id(gnss, "mock-gnss"),
                        "latitude": 52.0 + state.tick * 0.000001,
                        "longitude": 13.0 + math.sin(state.tick / 100) * 0.0001,
                        "altitude": 34.0,
                        "scenario": state.scenario,
                    },
                    state.study_id,
                    state.session_id,
                )
            if imu:
                await send_event(
                    socket,
                    f"events.{state.study_id}.{state.session_id}.driving.sensor.imu",
                    {
                        "timestamp": iso_timestamp(),
                        "frame": state.tick,
                        "sensorId": sensor_id(imu, "mock-imu"),
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
                    "simulationTime": simulation_time,
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
        update_health(status="connected", bridgeConnected=True, activeSessionId=state.session_id, scenario=state.scenario)
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
                    state.weather = config.get("weather", scenario.get("weather", {"preset": "ClearNoon", "custom": {}}))
                    state.traffic = {**scenario.get("traffic", {}), **config.get("traffic", {})}
                    state.sensors = config.get("sensors", [])
                    state.ego_vehicle = config.get("egoVehicle", {})
                    state.controls = {"throttle": float(scenario.get("baseThrottle", 0.45)), "brake": 0.0, "steer": 0.0}
                    state.paused = False
                    state.tick = 0
                    update_health(
                        status="running",
                        activeSessionId=state.session_id,
                        activeSession=state.session_id,
                        scenario=state.scenario,
                        simulationTime=0.0,
                    )
                    telemetry_task = asyncio.create_task(telemetry_loop(socket, state))
                    await send_response(
                        socket,
                        correlation_id,
                        {
                            "success": True,
                            "accepted": True,
                            "sessionId": state.session_id,
                            "activeSessionId": state.session_id,
                            "activeSession": state.session_id,
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
                    update_health(status="connected", activeSessionId=None, activeSession=None, scenario=state.scenario, simulationTime=0.0)
                    await send_response(
                        socket,
                        correlation_id,
                        {
                            "success": True,
                            "accepted": True,
                            "sessionId": released_session,
                            "activeSessionId": None,
                            "activeSession": None,
                        },
                    )
                    continue

                if action == "pause-session":
                    state.paused = True
                    update_health(status="paused", activeSessionId=state.session_id, activeSession=state.session_id, scenario=state.scenario)
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id})
                    continue

                if action == "resume-session":
                    state.paused = False
                    update_health(status="running", activeSessionId=state.session_id, activeSession=state.session_id, scenario=state.scenario)
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id})
                    continue

                if action == "load-map":
                    state.map_name = payload.get("mapName", state.map_name)
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id, "map": state.map_name})
                    continue

                if action == "set-weather":
                    state.weather = {
                        "preset": payload.get("preset", state.weather.get("preset", "ClearNoon")),
                        "custom": payload.get("custom", {}),
                    }
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id, "weather": state.weather})
                    continue

                if action == "spawn-vehicle":
                    state.ego_vehicle = {
                        **state.ego_vehicle,
                        "blueprint": payload.get("blueprint", state.ego_vehicle.get("blueprint", "vehicle.mock.ego")),
                        "roleName": payload.get("roleName", state.ego_vehicle.get("roleName", "hero")),
                        "spawnPointIndex": payload.get("spawnPointIndex", state.ego_vehicle.get("spawnPointIndex", 0)),
                        "autoPilot": bool(payload.get("autoPilot", state.ego_vehicle.get("autoPilot", False))),
                    }
                    await send_response(
                        socket,
                        correlation_id,
                        {
                            "success": True,
                            "accepted": True,
                            "sessionId": state.session_id,
                            "activeSessionId": state.session_id,
                            "activeSession": state.session_id,
                            "vehicle": state.ego_vehicle,
                        },
                    )
                    continue

                if action == "configure-sensors":
                    state.sensors = payload.get("sensors", [])
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id, "sensorCount": len(state.sensors)})
                    continue

                if action == "set-traffic":
                    state.traffic = payload
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id, "traffic": state.traffic})
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
                    await send_response(socket, correlation_id, {"success": True, "sessionId": state.session_id, "activeSessionId": state.session_id, "activeSession": state.session_id})
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
            update_health(status="disconnected", bridgeConnected=False, activeSessionId=None, activeSession=None, scenario=state.scenario)
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task
            await stop_telemetry(telemetry_task)


async def main() -> None:
    scenario_catalogue = load_scenario_catalogue(SCENARIO_CATALOGUE_PATH)
    update_health(status="starting", scenarioCount=len(scenario_catalogue), scenario=DEFAULT_SCENARIO)
    asyncio.create_task(health_server())
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

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from contextlib import suppress

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
        self.vehicle = None
        self.sensors = []
        self.tm = None
        self.study_id = None
        self.session_id = None
        self.paused = False
        self.pending_control = {"throttle": 0.0, "brake": 0.0, "steer": 0.0}
        self.connect_carla()

    def connect_carla(self) -> bool:
        if carla is None:
            self.client = None
            self.world = None
            return False
        try:
            self.client = carla.Client(CARLA_SERVER_HOST, CARLA_SERVER_PORT)
            self.client.set_timeout(8.0)
            self.world = self.client.get_world()
            return True
        except Exception:
            self.client = None
            self.world = None
            return False

    def has_world(self) -> bool:
        return self.client is not None and self.world is not None

    def ensure_connected(self) -> bool:
        return self.has_world() or self.connect_carla()

    def _float(self, value: object, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return default

    def _destroy_actors(self) -> None:
        for sensor in self.sensors:
            with suppress(Exception):
                sensor.stop()
            with suppress(Exception):
                sensor.destroy()
        self.sensors = []
        if self.vehicle is not None:
            with suppress(Exception):
                self.vehicle.destroy()
        self.vehicle = None

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

            if not self.ensure_connected():
                await asyncio.sleep(0.5)
                continue

            if self.world is not None:
                with suppress(Exception):
                    settings = self.world.get_settings()
                    settings.synchronous_mode = True
                    settings.fixed_delta_seconds = 0.05
                    self.world.apply_settings(settings)
                    self.world.tick()

            speed = round(self.pending_control["throttle"] * 120, 2)
            throttle = self.pending_control["throttle"]
            brake = self.pending_control["brake"]
            steer = self.pending_control["steer"]
            if self.vehicle is not None:
                with suppress(Exception):
                    transform = self.vehicle.get_transform()
                    velocity = self.vehicle.get_velocity()
                    speed = round((velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) ** 0.5 * 3.6, 2)
                    await self.send_event(
                        socket,
                        f"events.{study_id}.{run_id}.driving.vehicle.telemetry",
                        {
                            "timestamp": iso_timestamp(),
                            "vehicle": {
                                "speed": speed,
                                "speedLimit": 50,
                                "acceleration": 0.0,
                                "position": {"x": transform.location.x, "y": transform.location.y, "z": transform.location.z},
                                "rotation": {"pitch": transform.rotation.pitch, "yaw": transform.rotation.yaw, "roll": transform.rotation.roll},
                                "velocity": {"x": velocity.x, "y": velocity.y, "z": velocity.z},
                                "gear": getattr(self.vehicle.get_control(), "gear", 0),
                                "throttle": throttle,
                                "brake": brake,
                                "steer": steer,
                            },
                        },
                        study_id,
                        run_id,
                    )
                    tick += 1
                    await asyncio.sleep(0.05)
                    continue

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

    def apply_bind_config(self, config: dict) -> tuple[bool, str]:
        if not self.ensure_connected():
            return False, "CARLA server is unavailable"
        map_name = str(config.get("map") or "Town03")
        weather = config.get("weather") if isinstance(config.get("weather"), dict) else {}
        weather_preset = str(weather.get("preset") or "ClearNoon")
        vehicle_cfg = config.get("egoVehicle") if isinstance(config.get("egoVehicle"), dict) else {}
        blueprint = str(vehicle_cfg.get("blueprint") or "vehicle.lincoln.mkz_2020")
        traffic = config.get("traffic") if isinstance(config.get("traffic"), dict) else {}
        sensors = config.get("sensors") if isinstance(config.get("sensors"), list) else []

        ok, message = self.load_map(map_name)
        if not ok:
            return False, message
        ok, message = self.set_weather(weather_preset)
        if not ok:
            return False, message
        ok, message = self.spawn_vehicle(blueprint)
        if not ok:
            return False, message
        ok, message = self.configure_sensors(sensors)
        if not ok:
            return False, message
        ok, message = self.set_traffic(traffic)
        if not ok:
            return False, message
        return True, "Session configuration applied"

    def load_map(self, map_name: str) -> tuple[bool, str]:
        if not self.ensure_connected() or self.client is None:
            return False, "CARLA server is unavailable"
        try:
            self.world = self.client.load_world(map_name)
            return True, f"Loaded map {map_name}"
        except Exception as error:
            return False, f"Failed to load map: {error}"

    def set_weather(self, weather_preset: str) -> tuple[bool, str]:
        if not self.ensure_connected() or self.world is None or carla is None:
            return False, "CARLA world is unavailable"
        try:
            preset = getattr(carla.WeatherParameters, weather_preset)
            self.world.set_weather(preset)
            return True, f"Applied weather {weather_preset}"
        except Exception as error:
            return False, f"Failed to set weather: {error}"

    def spawn_vehicle(self, blueprint_name: str) -> tuple[bool, str]:
        if not self.ensure_connected() or self.world is None:
            return False, "CARLA world is unavailable"
        try:
            self._destroy_actors()
            blueprint_lib = self.world.get_blueprint_library()
            blueprint = blueprint_lib.find(blueprint_name)
            blueprint.set_attribute("role_name", "hero")
            spawn_points = self.world.get_map().get_spawn_points()
            if not spawn_points:
                return False, "No spawn points available"
            self.vehicle = self.world.spawn_actor(blueprint, spawn_points[0])
            return True, f"Spawned ego vehicle {blueprint_name}"
        except Exception as error:
            return False, f"Failed to spawn vehicle: {error}"

    def configure_sensors(self, sensor_configs: list[dict]) -> tuple[bool, str]:
        if self.world is None or self.vehicle is None:
            return False, "Ego vehicle is not available"
        self.sensors = []
        for sensor_config in sensor_configs:
            try:
                sensor_type = str(sensor_config.get("type") or "sensor.camera.rgb")
                sensor_id = str(sensor_config.get("id") or sensor_config.get("sensorId") or sensor_type)
                attributes = sensor_config.get("attributes") if isinstance(sensor_config.get("attributes"), dict) else {}
                transform_cfg = sensor_config.get("transform") if isinstance(sensor_config.get("transform"), dict) else {}
                blueprint = self.world.get_blueprint_library().find(sensor_type)
                for key, value in attributes.items():
                    blueprint.set_attribute(str(key), str(value))
                transform = carla.Transform(
                    carla.Location(
                        x=self._float(transform_cfg.get("x")),
                        y=self._float(transform_cfg.get("y")),
                        z=self._float(transform_cfg.get("z"), 1.2),
                    ),
                    carla.Rotation(
                        pitch=self._float(transform_cfg.get("pitch")),
                        yaw=self._float(transform_cfg.get("yaw")),
                        roll=self._float(transform_cfg.get("roll")),
                    ),
                )
                sensor = self.world.spawn_actor(blueprint, transform, attach_to=self.vehicle)
                sensor.listen(lambda _data, sid=sensor_id: None)
                self.sensors.append(sensor)
            except Exception as error:
                return False, f"Failed to configure sensor: {error}"
        return True, f"Configured {len(self.sensors)} sensors"

    def set_traffic(self, traffic_config: dict) -> tuple[bool, str]:
        if not self.ensure_connected() or self.client is None:
            return False, "CARLA server is unavailable"
        try:
            self.tm = self.client.get_trafficmanager()
            if "distanceToLeadingVehicle" in traffic_config:
                self.tm.set_global_distance_to_leading_vehicle(self._float(traffic_config.get("distanceToLeadingVehicle"), 2.0))
            if "globalSpeedDifference" in traffic_config:
                self.tm.global_percentage_speed_difference(self._float(traffic_config.get("globalSpeedDifference"), 0.0))
            return True, "Traffic manager configured"
        except Exception as error:
            return False, f"Failed to configure traffic: {error}"

    def set_spectator(self, spectator: dict) -> tuple[bool, str]:
        if self.world is None or self.vehicle is None:
            return False, "Spectator configuration requires active world and vehicle"
        try:
            target = self.vehicle.get_transform()
            offset = spectator.get("offset") if isinstance(spectator.get("offset"), dict) else {}
            spectator_actor = self.world.get_spectator()
            target.location.x += self._float(offset.get("x"), -6.0)
            target.location.z += self._float(offset.get("z"), 2.5)
            spectator_actor.set_transform(target)
            return True, "Spectator camera updated"
        except Exception as error:
            return False, f"Failed to set spectator: {error}"

    def start_recording(self, path: str | None) -> tuple[bool, str]:
        if self.client is None:
            return False, "CARLA server is unavailable"
        output = path or f"/tmp/scarline-{self.session_id or 'session'}.log"
        try:
            self.client.start_recorder(output)
            return True, f"Recording started at {output}"
        except Exception as error:
            return False, f"Failed to start recording: {error}"

    def stop_recording(self) -> tuple[bool, str]:
        if self.client is None:
            return False, "CARLA server is unavailable"
        try:
            self.client.stop_recorder()
            return True, "Recording stopped"
        except Exception as error:
            return False, f"Failed to stop recording: {error}"

    def apply_control(self, payload: dict) -> tuple[bool, str]:
        throttle = max(0.0, min(1.0, self._float(payload.get("throttle"), 0.0)))
        brake = max(0.0, min(1.0, self._float(payload.get("brake"), 0.0)))
        steer = max(-1.0, min(1.0, self._float(payload.get("steer"), 0.0)))
        self.pending_control = {"throttle": throttle, "brake": brake, "steer": steer}
        if self.vehicle is None or carla is None:
            return False, "Vehicle control unavailable without spawned ego vehicle"
        try:
            self.vehicle.apply_control(carla.VehicleControl(throttle=throttle, brake=brake, steer=steer))
            return True, "Vehicle control applied"
        except Exception as error:
            return False, f"Failed to apply control: {error}"

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
    while True:
        adapter = CarlaAdapter()
        telemetry_task = None
        heartbeat_task = None
        try:
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
                                    "spectator-control",
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
                        ok, detail = adapter.apply_bind_config(payload["payload"].get("config") if isinstance(payload["payload"].get("config"), dict) else {})
                        if ok and (telemetry_task is None or telemetry_task.done()):
                            telemetry_task = asyncio.create_task(adapter.telemetry_loop(socket, study_id, session_id))
                        await adapter.send_response(
                            socket,
                            correlation_id,
                            {
                                "success": ok,
                                "accepted": ok,
                                "message": detail,
                                "sessionId": session_id,
                                "activeSessionId": session_id if ok else None,
                                "simulatorType": "carla",
                            },
                        )
                        if not ok:
                            adapter.session_id = None
                            adapter.study_id = None
                        continue

                    if action == "unbind-session":
                        released_session = adapter.session_id
                        adapter.session_id = None
                        adapter.study_id = None
                        adapter.paused = False
                        adapter._destroy_actors()
                        if telemetry_task is not None:
                            telemetry_task.cancel()
                            with suppress(asyncio.CancelledError):
                                await telemetry_task
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
                        await adapter.send_response(socket, correlation_id, {"success": True, "accepted": True, "sessionId": adapter.session_id, "activeSessionId": adapter.session_id})
                        continue

                    if action == "resume-session":
                        adapter.paused = False
                        await adapter.send_response(socket, correlation_id, {"success": True, "accepted": True, "sessionId": adapter.session_id, "activeSessionId": adapter.session_id})
                        continue

                    ok = False
                    detail = "Unsupported action"
                    if action == "load-map":
                        ok, detail = adapter.load_map(str(payload["payload"].get("map") or payload["payload"].get("mapName") or "Town03"))
                    elif action == "set-weather":
                        weather_payload = payload["payload"].get("weather")
                        preset = "ClearNoon"
                        if isinstance(weather_payload, dict):
                            preset = str(weather_payload.get("preset") or preset)
                        elif isinstance(payload["payload"].get("preset"), str):
                            preset = str(payload["payload"].get("preset"))
                        ok, detail = adapter.set_weather(preset)
                    elif action == "spawn-vehicle":
                        vehicle_payload = payload["payload"].get("egoVehicle")
                        blueprint = "vehicle.lincoln.mkz_2020"
                        if isinstance(vehicle_payload, dict):
                            blueprint = str(vehicle_payload.get("blueprint") or blueprint)
                        elif isinstance(payload["payload"].get("blueprint"), str):
                            blueprint = str(payload["payload"].get("blueprint"))
                        ok, detail = adapter.spawn_vehicle(blueprint)
                    elif action == "configure-sensors":
                        sensors = payload["payload"].get("sensors")
                        ok, detail = adapter.configure_sensors(sensors if isinstance(sensors, list) else [])
                    elif action == "set-traffic":
                        traffic = payload["payload"].get("traffic")
                        ok, detail = adapter.set_traffic(traffic if isinstance(traffic, dict) else {})
                    elif action == "set-spectator":
                        spectator = payload["payload"].get("spectator")
                        ok, detail = adapter.set_spectator(spectator if isinstance(spectator, dict) else {})
                    elif action == "start-recording":
                        ok, detail = adapter.start_recording(str(payload["payload"].get("path") or ""))
                    elif action == "stop-recording":
                        ok, detail = adapter.stop_recording()
                    elif action == "apply-control":
                        ok, detail = adapter.apply_control(payload["payload"])

                    await adapter.send_response(
                        socket,
                        correlation_id,
                        {
                            "success": ok,
                            "accepted": ok,
                            "message": detail,
                            "sessionId": adapter.session_id,
                            "activeSessionId": adapter.session_id if ok else None,
                            "simulatorType": "carla",
                            **({"error": f"unsupported_action:{action}"} if action not in {
                                "load-map",
                                "set-weather",
                                "spawn-vehicle",
                                "configure-sensors",
                                "set-traffic",
                                "set-spectator",
                                "start-recording",
                                "stop-recording",
                                "apply-control",
                            } else {}),
                        },
                    )
        except Exception:
            await asyncio.sleep(2)
        finally:
            if telemetry_task is not None:
                telemetry_task.cancel()
                with suppress(asyncio.CancelledError):
                    await telemetry_task
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task


if __name__ == "__main__":
    asyncio.run(main())

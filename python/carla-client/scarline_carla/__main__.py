from __future__ import annotations

import asyncio
import json
import os
import threading
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
        # carla connection - 2026-08-23
        self.simulation_mode: str = "synchronous"
        self.fixed_delta_seconds: float = 0.05
        # end carla connection
        # carla connection - 2026-08-24
        self.npc_vehicles: list = []
        self._stop_spawning = threading.Event()  # signals NPC loops to abort on unbind
        # end carla connection
        self.connect_carla()

    def connect_carla(self) -> bool:
        if carla is None:
            self.client = None
            self.world = None
            return False
        # carla connection - 2026-08-23
        print(f"carla-client: connecting to CARLA server at {CARLA_SERVER_HOST}:{CARLA_SERVER_PORT}", flush=True)
        try:
            self.client = carla.Client(CARLA_SERVER_HOST, CARLA_SERVER_PORT)
            self.client.set_timeout(30.0)
            self.world = self.client.get_world()
            print("carla-client: CARLA server connected successfully", flush=True)
            return True
        except BaseException as error:
            print(f"carla-client: CARLA connection attempt failed: {error}", flush=True)
            self.client = None
            self.world = None
            return False
        # end carla connection

    def has_world(self) -> bool:
        return self.client is not None and self.world is not None

    def ensure_connected(self) -> bool:
        # carla connection - 2026-08-24: live probe so a CARLA server restart is detected
        # without needing a container restart.
        if self.client is not None and self.world is not None:
            try:
                self.world.get_settings()
                return True
            except Exception:
                print("carla-client: CARLA connection lost (server restarted?), reconnecting...", flush=True)
                self.client = None
                self.world = None
        return self.connect_carla()
        # end carla connection

    def _float(self, value: object, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return default

    def _destroy_actors(self) -> None:
        # carla connection - 2026-08-24: signal NPC spawn loops to stop before destroying
        self._stop_spawning.set()
        # end carla connection

        # 1. Stop active sensors
        sensors = self.sensors
        self.sensors = []
        for sensor in sensors:
            with suppress(BaseException):
                if getattr(sensor, "is_listening", False):
                    sensor.stop()

        # 2. Disable autopilot on all NPC vehicles and ego vehicle before destroying
        npcs = self.npc_vehicles
        self.npc_vehicles = []
        for npc in npcs:
            with suppress(BaseException):
                npc.set_autopilot(False)

        vehicle = self.vehicle
        self.vehicle = None
        if vehicle is not None:
            with suppress(BaseException):
                vehicle.set_autopilot(False)

        # 3. Destroy all actors safely via a single CARLA batch command
        all_actors = [a for a in (sensors + ([vehicle] if vehicle else []) + npcs) if a is not None]
        if self.client is not None and carla is not None and all_actors:
            with suppress(BaseException):
                commands = [carla.command.DestroyActor(x) for x in all_actors]
                self.client.apply_batch_sync(commands, False)

        # carla connection - 2026-09-01: clean up any leftover orphan hero/autopilot vehicles
        if self.world is not None:
            with suppress(Exception):
                orphans = [
                    a for a in self.world.get_actors().filter("vehicle.*")
                    if a.attributes.get("role_name") in ("hero", "autopilot")
                ]
                for o in orphans:
                    with suppress(Exception):
                        o.destroy()
        # end carla connection

        # 4. Reset CARLA and TM to asynchronous mode so server never freezes between sessions
        if self.world is not None:
            with suppress(BaseException):
                settings = self.world.get_settings()
                if settings.synchronous_mode:
                    settings.synchronous_mode = False
                    self.world.apply_settings(settings)
        if self.tm is not None:
            with suppress(BaseException):
                self.tm.set_synchronous_mode(False)
        # end carla connection

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
        try:
            tick = 0
            while self.session_id == run_id:
                loop_start = time.monotonic()
                if self.paused:
                    await asyncio.sleep(0.05)
                    continue

                # carla connection - 2026-08-24: use has_world() (simple object check) not
                # ensure_connected() (which does a world.get_settings() RPC on every tick)
                if not self.has_world():
                    await asyncio.sleep(0.5)
                    continue
                # end carla connection

                if self.world is not None and self.simulation_mode == "synchronous":
                    # carla connection - 2026-09-01: only tick when in synchronous mode
                    try:
                        self.world.tick()
                    except Exception:
                        self.client = None
                        self.world = None
                    # end carla connection

                speed = round(self.pending_control["throttle"] * 120, 2)
                throttle = self.pending_control["throttle"]
                brake = self.pending_control["brake"]
                steer = self.pending_control["steer"]
                if self.vehicle is not None and getattr(self.vehicle, 'is_alive', True):
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
                        elapsed = time.monotonic() - loop_start
                        sleep_time = max(0.001, self.fixed_delta_seconds - elapsed)
                        await asyncio.sleep(sleep_time)
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
            tick += 1
            elapsed = time.monotonic() - loop_start
            sleep_time = max(0.001, self.fixed_delta_seconds - elapsed)
            await asyncio.sleep(sleep_time)
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
        except (asyncio.CancelledError, BaseException):
            pass

    def apply_bind_config(self, config: dict) -> tuple[bool, str]:
        if not self.ensure_connected():
            return False, "CARLA server is unavailable"
        # carla connection - 2026-08-24: clean up any existing actors and reset stop signal before new session
        self._destroy_actors()
        self._stop_spawning.clear()
        # end carla connection
        map_name = str(config.get("map") or "Town03")
        weather = config.get("weather") if isinstance(config.get("weather"), dict) else {}
        weather_preset = str(weather.get("preset") or "ClearNoon")
        vehicle_cfg = config.get("egoVehicle") if isinstance(config.get("egoVehicle"), dict) else {}
        blueprint = str(vehicle_cfg.get("blueprint") or "vehicle.lincoln.mkz_2020")
        traffic = config.get("traffic") if isinstance(config.get("traffic"), dict) else {}
        sensors = config.get("sensors") if isinstance(config.get("sensors"), list) else []
        # carla connection - 2026-09-01: default to asynchronous mode for smooth 60+ FPS simulation
        self.simulation_mode = str(config.get("simulationMode") or "asynchronous")
        self.fixed_delta_seconds = float(config.get("fixedDeltaSeconds") or 0.05)
        # end carla connection
        # carla connection - 2026-08-24
        pedestrian_cfg = config.get("pedestrianConfig") if isinstance(config.get("pedestrianConfig"), dict) else {}
        spectator_cfg = config.get("spectatorConfig") if isinstance(config.get("spectatorConfig"), dict) else {}
        # end carla connection

        ok, message = self.load_map(map_name)
        if not ok:
            return False, message
        # carla connection - 2026-08-24: apply simulation settings once after map load instead of per-tick
        if self.world is not None:
            with suppress(Exception):
                settings = self.world.get_settings()
                settings.synchronous_mode = (self.simulation_mode == "synchronous")
                settings.fixed_delta_seconds = self.fixed_delta_seconds if self.simulation_mode == "synchronous" else None
                self.world.apply_settings(settings)
                print(f"carla-client: simulation mode={self.simulation_mode}, fixed_delta={settings.fixed_delta_seconds}", flush=True)
        if self.client is not None:
            with suppress(Exception):
                self.tm = self.client.get_trafficmanager()
                self.tm.set_synchronous_mode(self.simulation_mode == "synchronous")
        # end carla connection
        ok, message = self.set_weather(weather_preset)
        if not ok:
            return False, message
        ok, message = self.spawn_vehicle(blueprint)
        if not ok:
            return False, message
        # carla connection - 2026-08-24: move spectator camera behind ego vehicle after spawn
        self.set_spectator(spectator_cfg)
        # end carla connection
        ok, message = self.configure_sensors(sensors)
        if not ok:
            return False, message
        ok, message = self.set_traffic(traffic)
        if not ok:
            return False, message
        # carla connection - 2026-08-24: spawn pedestrians
        self.spawn_pedestrians(pedestrian_cfg)
        # end carla connection
        return True, "Session configuration applied"

    def load_map(self, map_name: str) -> tuple[bool, str]:
        if not self.ensure_connected() or self.client is None:
            return False, "CARLA server is unavailable"
        try:
            # carla connection - 2026-08-24: match against available maps for robust resolution (e.g. Town10 -> Town10HD)
            target_map = map_name
            with suppress(Exception):
                available_maps = self.client.get_available_maps()
                matched = [m for m in available_maps if m.endswith(map_name) or m.split('/')[-1] == map_name]
                if not matched and "Town10" in map_name:
                    matched = [m for m in available_maps if "Town10" in m]
                if matched:
                    target_map = matched[0]
            # carla connection - 2026-09-01: skip world reload if map is already active
            if self.world is not None:
                with suppress(Exception):
                    cur_map = self.world.get_map().name
                    if cur_map.endswith(target_map) or target_map.endswith(cur_map) or cur_map == target_map:
                        return True, f"Map {target_map} already active"
            # carla connection - 2026-09-01: set generous timeout during map loading
            self.client.set_timeout(90.0)
            self.world = self.client.load_world(target_map)
            self.client.set_timeout(30.0)
            # end carla connection
            return True, f"Loaded map {target_map}"
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
            if self.vehicle is not None:
                with suppress(Exception):
                    self.vehicle.destroy()
                self.vehicle = None
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
                self.sensors.append(sensor)
            except Exception as error:
                return False, f"Failed to configure sensor: {error}"
        return True, f"Configured {len(self.sensors)} sensors"

    def set_traffic(self, traffic_config: dict) -> tuple[bool, str]:
        if not self.ensure_connected() or self.client is None or self.world is None:
            return False, "CARLA server is unavailable"
        try:
            # carla connection - 2026-08-24: fix field names to match admin panel (npcVehicleCount, speedDifference)
            self._stop_spawning.clear()
            self.tm = self.client.get_trafficmanager()
            self.tm.set_synchronous_mode(self.simulation_mode == "synchronous")
            npc_count = int(traffic_config.get("npcVehicleCount") or traffic_config.get("npc_vehicle_count") or 0)
            speed_diff = self._float(traffic_config.get("speedDifference") or traffic_config.get("speed_difference"), 0.0)
            self.tm.global_percentage_speed_difference(speed_diff)

            if npc_count > 0:
                blueprint_lib = self.world.get_blueprint_library()
                vehicle_blueprints = [
                    bp for bp in blueprint_lib.filter("vehicle.*")
                    if bp.id != "vehicle.carlamotors.carlacola"
                    and bp.has_attribute("number_of_wheels")
                    and int(bp.get_attribute("number_of_wheels")) == 4
                ]
                spawn_points = self.world.get_map().get_spawn_points()
                available_points = spawn_points[1:] if len(spawn_points) > 1 else spawn_points
                import random
                random.shuffle(available_points)
                spawned = 0
                for i, sp in enumerate(available_points[:npc_count]):
                    if self._stop_spawning.is_set():
                        print("carla-client: NPC spawn aborted (session unbound)", flush=True)
                        break
                    bp = random.choice(vehicle_blueprints)
                    with suppress(Exception):
                        npc = self.world.try_spawn_actor(bp, sp)
                        if npc is not None:
                            npc.set_autopilot(True, self.tm.get_port())
                            self.npc_vehicles.append(npc)
                            spawned += 1
                print(f"carla-client: spawned {spawned}/{npc_count} NPC vehicles", flush=True)
            return True, f"Traffic configured — {len(self.npc_vehicles)} NPC vehicles active"
        except Exception as error:
            return False, f"Failed to configure traffic: {error}"

    # carla connection - 2026-08-24: pedestrian spawning
    def spawn_pedestrians(self, pedestrian_config: dict) -> None:
        if not self.ensure_connected() or self.world is None or carla is None:
            return
        count = int(pedestrian_config.get("pedestrianCount") or pedestrian_config.get("pedestrian_count") or 0)
        if count <= 0:
            return
        try:
            blueprint_lib = self.world.get_blueprint_library()
            walker_blueprints = blueprint_lib.filter("walker.pedestrian.*")
            spawned = 0
            for _ in range(count):
                # carla connection - 2026-08-24: abort if unbind arrived
                if self._stop_spawning.is_set():
                    print("carla-client: pedestrian spawn aborted (session unbound)", flush=True)
                    break
                # end carla connection
                bp = walker_blueprints[spawned % len(walker_blueprints)]
                if bp.has_attribute("is_invincible"):
                    bp.set_attribute("is_invincible", "false")
                loc = self.world.get_random_location_from_navigation()
                if loc is None:
                    continue
                transform = carla.Transform(loc)
                with suppress(Exception):
                    walker = self.world.try_spawn_actor(bp, transform)
                    if walker is not None:
                        self.npc_vehicles.append(walker)  # reuse npc_vehicles list for cleanup
                        spawned += 1
            print(f"carla-client: spawned {spawned}/{count} pedestrians", flush=True)
        except Exception as error:
            print(f"carla-client: pedestrian spawn error: {error}", flush=True)
    # end carla connection

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
            # carla connection - 2026-09-01: during active session or if world is already present,
            # use non-blocking has_world() to prevent 5-second RPC freezes on the event loop
            connected = self.has_world() if (self.session_id or self.has_world()) else self.ensure_connected()
            # end carla connection
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
                            "carlaConnected": connected,
                            "status": "ready" if connected else "degraded",
                        },
                    }
                )
            )
            await asyncio.sleep(5)

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
                # carla connection - 2026-08-23
                reg_status = "ready" if adapter.world is not None else "degraded"
                print(f"carla-client: connected to sim-bridge, registering with status={reg_status}", flush=True)
                # end carla connection
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
                                "simulatorVersion": "0.9.16",
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
                                "status": reg_status,
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
                        # carla connection - 2026-08-24: revert to synchronous - 90s timeout in
                        # sim-bridge handles any NPC count; no thread needed (no race on unbind)
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
                            print(f"carla-client: bind-session config failed: {detail}", flush=True)
                            adapter.session_id = None
                            adapter.study_id = None
                        # end carla connection
                        continue

                    if action == "unbind-session":
                        released_session = adapter.session_id
                        adapter.session_id = None
                        adapter.study_id = None
                        adapter.paused = False
                        # carla connection - 2026-08-24: cancel & await telemetry task BEFORE destroying actors
                        # to prevent C++ terminate calls from accessing destroyed actors.
                        if telemetry_task is not None:
                            telemetry_task.cancel()
                            with suppress(asyncio.CancelledError, BaseException):
                                await telemetry_task
                            telemetry_task = None
                        adapter._destroy_actors()
                        # end carla connection
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
        except Exception as error:
            # carla connection - 2026-08-23
            print(f"carla-client: connection error: {error}", flush=True)
            # end carla connection
            await asyncio.sleep(2)
        finally:
            if telemetry_task is not None:
                telemetry_task.cancel()
                with suppress(asyncio.CancelledError, BaseException):
                    await telemetry_task
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError, BaseException):
                    await heartbeat_task


if __name__ == "__main__":
    asyncio.run(main())

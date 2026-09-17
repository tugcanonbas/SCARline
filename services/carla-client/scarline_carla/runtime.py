import concurrent.futures
import logging
import math
import queue
import random
import threading
import time
from contextlib import suppress
from pathlib import Path
from typing import Any

from .config import Settings
from .models import safe_relative_directory

LOGGER = logging.getLogger("scarline.carla-runtime")

try:  # The module is intentionally optional for unit tests and diagnostics.
    import carla  # type: ignore
except ImportError:  # pragma: no cover - exercised only outside the CARLA image
    carla = None


class CarlaRuntime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client: Any = None
        self.world: Any = None
        self.traffic_manager: Any = None
        self.ego_vehicle: Any = None
        self.sensors: list[Any] = []
        self.vehicles: list[Any] = []
        self.walkers: list[Any] = []
        self.walker_controllers: list[Any] = []
        self.original_settings: Any = None
        self.active_configuration: dict[str, Any] | None = None
        self.paused = False
        self.recording_path: Path | None = None
        self.recording_active = False
        self.events: queue.SimpleQueue[dict[str, Any]] = queue.SimpleQueue()
        self.outbound_messages: queue.SimpleQueue[dict[str, Any]] = queue.SimpleQueue()
        self.lock = threading.RLock()
        self.last_control_at = 0.0
        self.last_control_timestamp = ""
        self.control_safe = False
        self._tick_thread: threading.Thread | None = None
        self._stop_tick_event = threading.Event()
        self._io_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="carla-io")

    @property
    def connected(self) -> bool:
        return self.client is not None and self.world is not None

    def connect(self, timeout: float = 30.0) -> None:
        if carla is None: raise RuntimeError("The CARLA Python API is not installed")
        client = carla.Client(self.settings.carla_host, self.settings.carla_port)
        client.set_timeout(timeout)
        server_version = str(client.get_server_version())
        client_version = str(client.get_client_version())
        expected = self.settings.expected_carla_version
        if server_version != expected and not server_version.startswith("0.9."):
            LOGGER.warning("CARLA server version (%s) differs from expected (%s)", server_version, expected)
        self.client = client
        self.world = client.get_world()
        self._cleanup(restore_settings=False)

    def recover(self, configuration: dict[str, Any], paused: bool) -> None:
        self.bind(configuration)
        self.paused = paused

    def bind(self, session: dict[str, Any]) -> None:
        with self.lock:
            if not self.connected: self.connect()
            previous_recording = self._stop_recording()
            if previous_recording is not None: self.events.put(previous_recording)
            self._cleanup(restore_settings=True)
            if self.world is not None:
                with suppress(Exception):
                    self.world.wait_for_tick(0.5)
            configuration = session["configuration"]
            target_map = configuration["map"]
            try:
                cur_map = ""
                try:
                    if self.world is not None:
                        cur_map = str(self.world.get_map().name)
                except Exception:
                    pass
                if not (cur_map.endswith(target_map) or target_map.endswith(cur_map) or cur_map == target_map):
                    self.client.set_timeout(90.0)
                    self.world = self.client.load_world(target_map)
                    self.client.set_timeout(30.0)
                else:
                    self.client.set_timeout(30.0)
                self.original_settings = self.world.get_settings()
                self.traffic_manager = self.client.get_trafficmanager()
                self.traffic_manager.set_synchronous_mode(False)
                self.traffic_manager.set_random_device_seed(configuration["randomSeed"])
                speed_diff = float(configuration["trafficConfig"].get("speedDifference", 0.0))
                if speed_diff == 0.0:
                    speed_diff = 10.0
                self.traffic_manager.global_percentage_speed_difference(speed_diff)
                try:
                    self.traffic_manager.set_global_distance_to_leading_vehicle(4.0)
                    self.traffic_manager.global_percentage_ignore_lights(0.0)
                    self.traffic_manager.global_percentage_ignore_vehicles(0.0)
                    self.traffic_manager.global_percentage_ignore_walkers(0.0)
                    self.traffic_manager.global_percentage_random_left_lane_change(0.0)
                    self.traffic_manager.global_percentage_random_right_lane_change(0.0)
                    self.traffic_manager.set_global_percentage_keep_right_rule(70.0)
                    self.traffic_manager.set_hybrid_physics_mode(True)
                    self.traffic_manager.set_hybrid_physics_radius(70.0)
                    self.traffic_manager.set_respawn_dormant_vehicles(True)
                    self.traffic_manager.set_boundaries_respawn_dormant_vehicles(25.0, 180.0)
                except Exception as error:
                    LOGGER.debug("Could not set TM performance settings: %s", error)

                settings = self.world.get_settings()
                settings.synchronous_mode = False
                settings.fixed_delta_seconds = None
                settings.substepping = True
                settings.max_substep_delta_time = 0.01
                settings.max_substeps = 10
                self.world.apply_settings(settings)
                self._apply_weather(configuration)
                spawn_points = list(self.world.get_map().get_spawn_points())
                random.Random(configuration["randomSeed"]).shuffle(spawn_points)
                if not spawn_points: raise RuntimeError("The selected CARLA map has no vehicle spawn points")
                self.ego_vehicle = self._spawn_ego_vehicle(configuration["egoVehicleBlueprint"], spawn_points, "hero")
                self.vehicles.append(self.ego_vehicle)
                self._spawn_traffic(configuration, spawn_points)
                self._spawn_pedestrians(configuration)
                self.active_configuration = session
                self._configure_sensors(configuration["sensors"])
                if configuration["controlMode"] == "autopilot":
                    self.ego_vehicle.set_autopilot(True, self.traffic_manager.get_port())
                    self._apply_speed_limit_override(self.ego_vehicle, configuration["trafficConfig"].get("speedLimitOverride"))
                else:
                    self.ego_vehicle.set_autopilot(False, self.traffic_manager.get_port())
                    self._apply_vehicle_control(0.0, 0.0, 1.0)
                self.last_control_at = time.monotonic()
                self.last_control_timestamp = ""
                self.control_safe = configuration["controlMode"] == "io"
                if configuration["recordingConfig"]["enabled"]: self._start_recording(configuration["recordingConfig"])
                self._start_tick_thread()
            except Exception:
                self._cleanup(restore_settings=True)
                raise

    def advance(self, session: dict[str, Any]) -> None:
        self.bind(session)

    def pause(self) -> None:
        self.paused = True

    def resume(self) -> None:
        if self.active_configuration is None: raise RuntimeError("No CARLA session is bound")
        self.paused = False

    def unbind(self) -> dict[str, Any] | None:
        with self.lock:
            try:
                artifact = self._stop_recording()
            except Exception:
                artifact = None
            self._cleanup(restore_settings=True)
            return artifact

    def close(self) -> None:
        with self.lock:
            try:
                self._stop_recording()
            except Exception:
                pass
            self._cleanup(restore_settings=True)
            self.client = None
            self.world = None

    def _start_tick_thread(self) -> None:
        self._stop_tick_event.clear()
        if self._tick_thread is None or not self._tick_thread.is_alive():
            self._tick_thread = threading.Thread(target=self._tick_worker, name="carla-tick-worker", daemon=True)
            self._tick_thread.start()

    def _stop_tick_thread(self) -> None:
        self._stop_tick_event.set()
        if self._tick_thread is not None and self._tick_thread.is_alive():
            self._tick_thread.join(timeout=2.5)
            self._tick_thread = None

    def _tick_worker(self) -> None:
        tick_count = 0
        while not self._stop_tick_event.is_set():
            active = self.active_configuration
            world = self.world
            ego = self.ego_vehicle

            if active is not None and not self.paused and world is not None and ego is not None:
                try:
                    configuration = active["configuration"]
                    if configuration.get("controlMode") == "io":
                        self._enforce_control_timeout()

                    snapshot = world.wait_for_tick(2.0)
                    if self._stop_tick_event.is_set() or self.active_configuration is None:
                        break
                    tick_count += 1

                    # Emit telemetry every 3 ticks (~20 Hz) for lightweight network bandwidth at 60 FPS
                    if tick_count % 3 == 0:
                        try:
                            if ego is not None and getattr(ego, "is_alive", False):
                                velocity = ego.get_velocity()
                                control = ego.get_control()
                                speed = math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) * 3.6
                                configured_speed_limit = configuration.get("trafficConfig", {}).get("speedLimitOverride")
                                speed_limit = float(configured_speed_limit) if configured_speed_limit is not None else float(ego.get_speed_limit())
                                self.outbound_messages.put({
                                    "type": "vehicle.telemetry",
                                    "speed": max(0.0, speed),
                                    "speedLimit": max(0.0, speed_limit),
                                    "throttle": max(0.0, min(1.0, float(control.throttle))),
                                    "steer": max(-1.0, min(1.0, float(control.steer))),
                                    "brake": max(0.0, min(1.0, float(control.brake))),
                                })
                        except (Exception, RuntimeError, BaseException):
                            pass

                    while True:
                        try:
                            self.outbound_messages.put(self.events.get_nowait())
                        except queue.Empty:
                            break
                except Exception as error:
                    if not self._stop_tick_event.is_set() and self.active_configuration is not None:
                        LOGGER.warning("CARLA simulation tick warning: %s", error)
            else:
                time.sleep(0.02)

    def tick(self) -> list[dict[str, Any]]:
        messages = []
        while len(messages) < 100:
            try:
                messages.append(self.outbound_messages.get_nowait())
            except queue.Empty:
                break
        return messages

    def apply_realtime_control(self, message: dict[str, Any]) -> None:
        with self.lock:
            active = self.active_configuration
            if active is None or self.paused or active["configuration"]["controlMode"] != "io": return
            if message["sessionId"] != active["sessionId"] or message["sessionConditionId"] != active["sessionConditionId"]: return
            if message["sourceTimestamp"] <= self.last_control_timestamp: return
            self.last_control_timestamp = message["sourceTimestamp"]
            self.last_control_at = time.monotonic()
            self.control_safe = False
            self._apply_vehicle_control(message["throttle"], message["steer"], message["brake"])

    def apply_external_control(self, parameters: dict[str, Any]) -> None:
        with self.lock:
            if self.active_configuration is None or self.active_configuration["configuration"]["controlMode"] != "external":
                raise RuntimeError("External vehicle control is not enabled for this condition")
            self._apply_vehicle_control(
                max(0.0, min(1.0, float(parameters.get("throttle", 0)))),
                max(-1.0, min(1.0, float(parameters.get("steer", 0)))),
                max(0.0, min(1.0, float(parameters.get("brake", 0)))),
            )

    def command(self, name: str, parameters: dict[str, Any]) -> str:
        if name == "carla.vehicle.control":
            self.apply_external_control(parameters); return "Vehicle control applied"
        if name == "carla.recording.start":
            self._start_recording({"directory": parameters.get("directory")}); return "CARLA recording started"
        if name == "carla.recording.stop":
            self._stop_recording(); return "CARLA recording stopped"
        if name == "carla.weather.set":
            if self.active_configuration is None: raise RuntimeError("No CARLA session is bound")
            configuration = dict(self.active_configuration["configuration"])
            configuration["weatherPreset"] = parameters.get("preset")
            self._apply_weather(configuration); return "CARLA weather updated"
        if name == "carla.spectator.set":
            self._configure_spectator(parameters); return "CARLA spectator updated"
        raise RuntimeError(f"Unsupported CARLA command: {name}")

    def _apply_weather(self, configuration: dict[str, Any]) -> None:
        preset_name = configuration.get("weatherPreset")
        if preset_name:
            try: weather = getattr(carla.WeatherParameters, str(preset_name))
            except AttributeError as error: raise RuntimeError(f"Unknown CARLA weather preset: {preset_name}") from error
        else: weather = carla.WeatherParameters()
        custom = configuration["weatherCustom"]
        if not preset_name:
            weather.cloudiness = float(custom["cloudiness"])
            weather.precipitation = float(custom["precipitation"])
            weather.wind_intensity = float(custom["windIntensity"])
        weather.sun_altitude_angle = float(configuration["sunConfig"]["sunAltitudeAngle"])
        self.world.set_weather(weather)

    def _clear_vehicles_at_location(self, target_location: Any, clearance_radius: float = 12.0) -> None:
        """Clear any vehicles or walkers within clearance_radius meters of target_location."""
        try:
            actors_to_clear = []
            for actor in self.world.get_actors():
                try:
                    if getattr(actor, "is_alive", False):
                        loc = actor.get_location()
                        dist = math.sqrt((loc.x - target_location.x)**2 + (loc.y - target_location.y)**2 + (loc.z - target_location.z)**2)
                        if dist < clearance_radius:
                            actors_to_clear.append(actor)
                except Exception:
                    pass
            if actors_to_clear and self.client is not None and carla is not None:
                try:
                    self.client.apply_batch_sync([carla.command.DestroyActor(x) for x in actors_to_clear], False)
                except Exception:
                    for a in actors_to_clear:
                        with suppress(Exception):
                            a.destroy()
        except Exception:
            pass

    def _spawn_ego_vehicle(self, blueprint_id: str, spawn_points: list[Any], role_name: str) -> Any:
        # Despawn any preexisting hero vehicles first
        try:
            old_heros = []
            for actor in self.world.get_actors().filter("vehicle.*"):
                with suppress(Exception):
                    if actor.attributes.get("role_name") == role_name:
                        old_heros.append(actor)
            if old_heros:
                if self.client is not None and carla is not None:
                    with suppress(Exception):
                        self.client.apply_batch_sync([carla.command.DestroyActor(x) for x in old_heros], False)
                for h in old_heros:
                    with suppress(Exception):
                        h.destroy()
        except Exception:
            pass

        library = self.world.get_blueprint_library()
        try:
            blueprint = library.find(blueprint_id)
        except Exception:
            try:
                blueprint = library.find("vehicle.tesla.model3")
            except Exception:
                blueprints = list(library.filter("vehicle.*"))
                if not blueprints:
                    raise RuntimeError("No vehicle blueprints available in CARLA library")
                blueprint = blueprints[0]
        if blueprint.has_attribute("role_name"):
            blueprint.set_attribute("role_name", role_name)
        if blueprint.has_attribute("color"):
            with suppress(Exception):
                color = random.choice(blueprint.get_attribute("color").recommended_values) if blueprint.get_attribute("color").recommended_values else "255,0,0"
                blueprint.set_attribute("color", color)

        for i in range(len(spawn_points)):
            sp = spawn_points[i]
            self._clear_vehicles_at_location(sp.location, clearance_radius=12.0)
            actor = self.world.try_spawn_actor(blueprint, sp)
            if actor is not None:
                spawn_points.pop(i)
                return actor

        # Fallback with slight elevation (+0.5m) in case terrain ground contact caused obstruction
        for sp in spawn_points:
            self._clear_vehicles_at_location(sp.location, clearance_radius=12.0)
            elevated = carla.Transform(
                carla.Location(x=sp.location.x, y=sp.location.y, z=sp.location.z + 0.5),
                sp.rotation,
            )
            actor = self.world.try_spawn_actor(blueprint, elevated)
            if actor is not None:
                return actor

        raise RuntimeError(f"Could not spawn ego vehicle {blueprint_id} (all {len(spawn_points)} spawn points occupied/obstructed)")

    def _spawn_vehicle(self, blueprint_id: str, transform: Any, role_name: str) -> Any:
        library = self.world.get_blueprint_library()
        try: blueprint = library.find(blueprint_id)
        except Exception as error: raise RuntimeError(f"Unknown CARLA vehicle blueprint: {blueprint_id}") from error
        if blueprint.has_attribute("role_name"): blueprint.set_attribute("role_name", role_name)
        actor = self.world.try_spawn_actor(blueprint, transform)
        if actor is None: raise RuntimeError(f"Could not spawn {blueprint_id}")
        return actor

    def _spawn_traffic(self, configuration: dict[str, Any], spawn_points: list[Any]) -> None:
        count = int(configuration["trafficConfig"].get("npcVehicleCount", 0))
        if count <= 0:
            return
        blueprints = list(self.world.get_blueprint_library().filter("vehicle.*"))
        randomizer = random.Random(configuration["randomSeed"])
        spawned_count = 0
        for sp in spawn_points:
            if spawned_count >= count:
                break
            blueprint = randomizer.choice(blueprints)
            if blueprint.has_attribute("role_name"):
                blueprint.set_attribute("role_name", "autopilot")
            if blueprint.has_attribute("color"):
                with suppress(Exception):
                    color = random.choice(blueprint.get_attribute("color").recommended_values) if blueprint.get_attribute("color").recommended_values else "0,0,200"
                    blueprint.set_attribute("color", color)
            actor = self.world.try_spawn_actor(blueprint, sp)
            if actor is None:
                # Try slight elevation in case ground plane contact caused collision rejection
                elevated = carla.Transform(carla.Location(x=sp.location.x, y=sp.location.y, z=sp.location.z + 0.3), sp.rotation)
                actor = self.world.try_spawn_actor(blueprint, elevated)
            if actor is not None:
                self.vehicles.append(actor)
                actor.set_autopilot(True, self.traffic_manager.get_port())
                try:
                    self.traffic_manager.auto_lane_change(actor, False)
                    self.traffic_manager.distance_to_leading_vehicle(actor, 4.0)
                    self.traffic_manager.ignore_lights_percentage(actor, 0.0)
                    self.traffic_manager.ignore_vehicles_percentage(actor, 0.0)
                    self.traffic_manager.ignore_walkers_percentage(actor, 0.0)
                except Exception:
                    pass
                self._apply_speed_limit_override(actor, configuration["trafficConfig"].get("speedLimitOverride"))
                spawned_count += 1

    def _apply_speed_limit_override(self, actor: Any, speed_limit_override: Any) -> None:
        if speed_limit_override is None: return
        map_limit = float(actor.get_speed_limit())
        if map_limit <= 0: return
        percentage_difference = (map_limit - float(speed_limit_override)) / map_limit * 100.0
        self.traffic_manager.vehicle_percentage_speed_difference(actor, percentage_difference)

    def _spawn_pedestrians(self, configuration: dict[str, Any]) -> None:
        count = configuration["pedestrianConfig"]["pedestrianCount"]
        if count == 0: return
        blueprints = list(self.world.get_blueprint_library().filter("walker.pedestrian.*"))
        controller_blueprint = self.world.get_blueprint_library().find("controller.ai.walker")
        randomizer = random.Random(configuration["randomSeed"] + 1)
        for _ in range(count):
            location = self.world.get_random_location_from_navigation()
            if location is None: continue
            walker = self.world.try_spawn_actor(randomizer.choice(blueprints), carla.Transform(location))
            if walker is None: continue
            self.walkers.append(walker)
            controller = self.world.try_spawn_actor(controller_blueprint, carla.Transform(), attach_to=walker)
            if controller is None: continue
            self.walker_controllers.append(controller)
            controller.start()
            destination = self.world.get_random_location_from_navigation()
            if destination is not None: controller.go_to_location(destination)
            controller.set_max_speed(1.4)

    def _configure_sensors(self, configurations: list[dict[str, Any]]) -> None:
        for configuration in configurations:
            blueprint = self.world.get_blueprint_library().find(configuration["type"])
            for key, value in configuration["attributes"].items():
                if not blueprint.has_attribute(str(key)): raise RuntimeError(f"Sensor {configuration['id']} does not support attribute {key}")
                blueprint.set_attribute(str(key), str(value))
            value = configuration["transform"]
            transform = carla.Transform(
                carla.Location(x=float(value.get("x", 0)), y=float(value.get("y", 0)), z=float(value.get("z", 0))),
                carla.Rotation(pitch=float(value.get("pitch", 0)), yaw=float(value.get("yaw", 0)), roll=float(value.get("roll", 0))),
            )
            sensor = self.world.spawn_actor(blueprint, transform, attach_to=self.ego_vehicle)
            sensor.listen(self._sensor_callback(configuration["id"], configuration["type"]))
            self.sensors.append(sensor)

    def _sensor_callback(self, sensor_id: str, sensor_type: str):
        def callback(data: Any) -> None:
            try:
                if sensor_type == "sensor.other.collision":
                    impulse = data.normal_impulse
                    other_actor = getattr(data, "other_actor", None)
                    other_actor_type = "unknown"
                    if other_actor is not None:
                        try:
                            if getattr(other_actor, "is_alive", False):
                                other_actor_type = str(other_actor.type_id)
                        except Exception:
                            pass
                    self.events.put({"type":"simulator.collision","otherActor":other_actor_type,"impulse":math.sqrt(impulse.x**2+impulse.y**2+impulse.z**2)})
                elif sensor_type == "sensor.other.lane_invasion":
                    self.events.put({"type":"simulator.lane_invasion","markings":[str(marking.type) for marking in data.crossed_lane_markings]})
                elif sensor_type == "sensor.other.gnss":
                    self.events.put({"type":"simulator.gnss","sensorId":sensor_id,"latitude":float(data.latitude),"longitude":float(data.longitude),"altitude":float(data.altitude)})
                elif sensor_type == "sensor.other.imu":
                    self.events.put({"type":"simulator.imu","sensorId":sensor_id,"accelerometer":self._vector(data.accelerometer),"gyroscope":self._vector(data.gyroscope),"compass":float(data.compass)})
                elif sensor_type.startswith("sensor.camera.") or sensor_type.startswith("sensor.lidar."):
                    self._store_sensor_artifact(sensor_id, sensor_type, data)
            except Exception as error:
                self.events.put({"type":"adapter.error","code":"SENSOR_PROCESSING_FAILED","message":str(error)[:2000],"fatal":False,"details":{"sensorId":sensor_id}})
        return callback

    def _store_sensor_artifact(self, sensor_id: str, sensor_type: str, data: Any) -> None:
        if self.active_configuration is None or not self.recording_active: return
        session_id = self.active_configuration["sessionId"]
        suffix = "png" if sensor_type.startswith("sensor.camera.") else "ply"
        relative = Path(session_id) / sensor_id / f"{int(data.frame):010d}.{suffix}"
        target = self.settings.media_directory / relative
        frame_num = int(data.frame)
        
        def save_task() -> None:
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                data.save_to_disk(str(target))
                self.events.put({
                    "type":"simulator.sensor_artifact",
                    "sensorId":sensor_id,
                    "kind":"camera" if suffix == "png" else "lidar",
                    "frame":frame_num,
                    "reference":f"carla://{relative.as_posix()}",
                    "metadata":{},
                })
            except Exception as error:
                self.events.put({
                    "type":"adapter.error",
                    "code":"SENSOR_PROCESSING_FAILED",
                    "message":str(error)[:2000],
                    "fatal":False,
                    "details":{"sensorId":sensor_id},
                })

        self._io_executor.submit(save_task)

    def _configure_spectator(self, configuration: dict[str, Any]) -> None:
        if not configuration.get("enabled", True) or self.ego_vehicle is None: return
        try:
            if not self.ego_vehicle.is_alive: return
            vehicle = self.ego_vehicle.get_transform()
            transform = carla.Transform(
                carla.Location(x=vehicle.location.x + float(configuration.get("x", -6)), y=vehicle.location.y + float(configuration.get("y", 0)), z=vehicle.location.z + float(configuration.get("z", 4))),
                carla.Rotation(pitch=float(configuration.get("pitch", -15)), yaw=vehicle.rotation.yaw + float(configuration.get("yaw", 0)), roll=float(configuration.get("roll", 0))),
            )
            self.world.get_spectator().set_transform(transform)
        except Exception:
            pass

    def _start_recording(self, configuration: dict[str, Any]) -> None:
        if self.active_configuration is None: raise RuntimeError("No CARLA session is bound")
        if self.recording_active: return
        base = self.settings.media_directory / self.active_configuration["sessionId"]
        directory = safe_relative_directory(configuration.get("directory"))
        if directory: base = base / str(directory)
        base.mkdir(parents=True, exist_ok=True)
        self.recording_path = base / "carla-recorder.log"
        self.client.start_recorder(str(self.recording_path))
        self.recording_active = True

    def _stop_recording(self) -> dict[str, Any] | None:
        if not self.recording_active or self.client is None: return None
        self.client.stop_recorder()
        self.recording_active = False
        if self.recording_path is None or self.active_configuration is None: return None
        relative = self.recording_path.relative_to(self.settings.media_directory)
        return {"type":"simulator.sensor_artifact","sensorId":"carla-recorder","kind":"recorder","frame":None,"reference":f"carla://{relative.as_posix()}","metadata":{}}

    def _apply_vehicle_control(self, throttle: float, steer: float, brake: float) -> None:
        if self.ego_vehicle is None: return
        try:
            if self.ego_vehicle.is_alive:
                self.ego_vehicle.apply_control(carla.VehicleControl(throttle=float(throttle), steer=float(steer), brake=float(brake)))
        except Exception:
            pass

    def _enforce_control_timeout(self) -> None:
        elapsed = (time.monotonic() - self.last_control_at) * 1_000
        if elapsed <= self.settings.control_timeout_milliseconds or self.control_safe: return
        self._apply_vehicle_control(0.0, 0.0, 1.0)
        self.control_safe = True
        self.events.put({"type":"adapter.error","code":"CONTROL_INPUT_STALE","message":"Real-time vehicle control timed out; the safety brake was applied.","fatal":False,"details":{}})

    def _cleanup(self, restore_settings: bool) -> None:
        self._stop_tick_thread()
        self.ego_vehicle = None
        self.active_configuration = None
        self.paused = False

        # 1. Stop all sensors first to prevent in-flight callbacks
        for sensor in self.sensors:
            try:
                if sensor is not None and getattr(sensor, "is_alive", False):
                    try:
                        if getattr(sensor, "is_listening", False):
                            sensor.stop()
                    except Exception:
                        pass
            except Exception:
                pass
        for controller in self.walker_controllers:
            try:
                if controller is not None and getattr(controller, "is_alive", False):
                    controller.stop()
            except Exception:
                pass

        # 2. Batch destroy all tracked session actors
        all_actors = [a for a in [*self.sensors, *self.walker_controllers, *self.walkers, *self.vehicles] if a is not None]
        if self.client is not None and carla is not None and all_actors:
            try:
                commands = [carla.command.DestroyActor(x) for x in all_actors if getattr(x, "is_alive", False)]
                if commands:
                    self.client.apply_batch_sync(commands, False)
            except Exception:
                for actor in all_actors:
                    try:
                        if getattr(actor, "is_alive", False):
                            actor.destroy()
                    except Exception:
                        pass
        else:
            for actor in all_actors:
                try:
                    if getattr(actor, "is_alive", False):
                        actor.destroy()
                except Exception:
                    pass

        # 3. Clean up any leftover orphan hero / autopilot vehicles or walkers
        if self.world is not None:
            try:
                orphan_actors = []
                for actor in self.world.get_actors():
                    try:
                        if getattr(actor, "is_alive", False):
                            type_id = getattr(actor, "type_id", "")
                            role = ""
                            if hasattr(actor, "attributes"):
                                with suppress(Exception):
                                    role = actor.attributes.get("role_name", "")
                            if role in ("hero", "autopilot") or type_id.startswith("walker.") or type_id.startswith("controller.ai.walker"):
                                orphan_actors.append(actor)
                    except Exception:
                        pass
                if orphan_actors:
                    if self.client is not None and carla is not None:
                        try:
                            self.client.apply_batch_sync([carla.command.DestroyActor(x) for x in orphan_actors], False)
                        except Exception:
                            for o in orphan_actors:
                                try:
                                    if getattr(o, "is_alive", False):
                                        o.destroy()
                                except Exception:
                                    pass
                    else:
                        for o in orphan_actors:
                            try:
                                if getattr(o, "is_alive", False):
                                    o.destroy()
                            except Exception:
                                pass
            except Exception:
                pass

        if self.traffic_manager is not None:
            try: self.traffic_manager.set_synchronous_mode(False)
            except Exception: pass
        if restore_settings and self.world is not None and self.original_settings is not None:
            try: self.world.apply_settings(self.original_settings)
            except Exception: pass
        self.sensors = []; self.walker_controllers = []; self.walkers = []; self.vehicles = []
        self.traffic_manager = None; self.original_settings = None
        self.recording_path = None; self.recording_active = False

    @staticmethod
    def _vector(value: Any) -> dict[str, float]:
        return {"x":float(value.x),"y":float(value.y),"z":float(value.z)}

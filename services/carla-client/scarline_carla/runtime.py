from __future__ import annotations

import math
import queue
import random
import threading
import time
from pathlib import Path
from typing import Any

from .config import Settings
from .models import safe_relative_directory

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
        self.lock = threading.RLock()
        self.last_control_at = 0.0
        self.last_control_timestamp = ""
        self.control_safe = False

    @property
    def connected(self) -> bool:
        return self.client is not None and self.world is not None

    def connect(self) -> None:
        if carla is None: raise RuntimeError("The CARLA Python API is not installed")
        client = carla.Client(self.settings.carla_host, self.settings.carla_port)
        client.set_timeout(10.0)
        server_version = str(client.get_server_version())
        client_version = str(client.get_client_version())
        expected = self.settings.expected_carla_version
        if server_version != expected or client_version != expected:
            raise RuntimeError(f"CARLA version mismatch: expected {expected}, client {client_version}, server {server_version}")
        self.client = client
        self.world = client.get_world()

    def recover(self, configuration: dict[str, Any], paused: bool) -> None:
        self.bind(configuration)
        self.paused = paused

    def bind(self, session: dict[str, Any]) -> None:
        with self.lock:
            if not self.connected: self.connect()
            previous_recording = self._stop_recording()
            if previous_recording is not None: self.events.put(previous_recording)
            self._cleanup(restore_settings=True)
            configuration = session["configuration"]
            try:
                self.world = self.client.load_world(configuration["map"])
                self.original_settings = self.world.get_settings()
                settings = self.world.get_settings()
                settings.synchronous_mode = True
                settings.fixed_delta_seconds = 0.05
                self.world.apply_settings(settings)
                self.traffic_manager = self.client.get_trafficmanager()
                self.traffic_manager.set_synchronous_mode(True)
                self.traffic_manager.set_random_device_seed(configuration["randomSeed"])
                self.traffic_manager.global_percentage_speed_difference(float(configuration["trafficConfig"]["speedDifference"]))
                self._apply_weather(configuration)
                spawn_points = list(self.world.get_map().get_spawn_points())
                random.Random(configuration["randomSeed"]).shuffle(spawn_points)
                if not spawn_points: raise RuntimeError("The selected CARLA map has no vehicle spawn points")
                self.ego_vehicle = self._spawn_vehicle(configuration["egoVehicleBlueprint"], spawn_points.pop(0), "hero")
                self.vehicles.append(self.ego_vehicle)
                self._spawn_traffic(configuration, spawn_points)
                self._spawn_pedestrians(configuration)
                self.active_configuration = session
                self._configure_sensors(configuration["sensors"])
                self._configure_spectator(configuration["spectatorConfig"])
                if configuration["controlMode"] == "autopilot":
                    self.ego_vehicle.set_autopilot(True, self.traffic_manager.get_port())
                    self._apply_speed_limit_override(self.ego_vehicle, configuration["trafficConfig"].get("speedLimitOverride"))
                else:
                    self.ego_vehicle.set_autopilot(False, self.traffic_manager.get_port())
                    self._apply_vehicle_control(0.0, 0.0, 1.0)
                self.paused = False
                self.last_control_at = time.monotonic()
                self.last_control_timestamp = ""
                self.control_safe = configuration["controlMode"] == "io"
                if configuration["recordingConfig"]["enabled"]: self._start_recording(configuration["recordingConfig"])
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
            artifact = self._stop_recording()
            self._cleanup(restore_settings=True)
            return artifact

    def close(self) -> None:
        with self.lock:
            self._stop_recording()
            self._cleanup(restore_settings=True)
            self.client = None
            self.world = None

    def tick(self) -> list[dict[str, Any]]:
        with self.lock:
            if self.active_configuration is None or self.paused: return []
            if self.world is None or self.ego_vehicle is None: raise RuntimeError("CARLA world or ego vehicle disappeared")
            configuration = self.active_configuration["configuration"]
            if configuration["controlMode"] == "io": self._enforce_control_timeout()
            frame = int(self.world.tick(10.0))
            velocity = self.ego_vehicle.get_velocity()
            control = self.ego_vehicle.get_control()
            speed = math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) * 3.6
            configured_speed_limit = configuration["trafficConfig"].get("speedLimitOverride")
            speed_limit = float(configured_speed_limit) if configured_speed_limit is not None else float(self.ego_vehicle.get_speed_limit())
            messages = [{
                "type": "vehicle.telemetry",
                "speed": max(0.0, speed),
                "speedLimit": max(0.0, speed_limit),
                "throttle": max(0.0, min(1.0, float(control.throttle))),
                "steer": max(-1.0, min(1.0, float(control.steer))),
                "brake": max(0.0, min(1.0, float(control.brake))),
            }]
            while len(messages) < 101:
                try: messages.append(self.events.get_nowait())
                except queue.Empty: break
            if frame < 0: raise RuntimeError("CARLA returned an invalid frame")
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

    def _spawn_vehicle(self, blueprint_id: str, transform: Any, role_name: str) -> Any:
        library = self.world.get_blueprint_library()
        try: blueprint = library.find(blueprint_id)
        except Exception as error: raise RuntimeError(f"Unknown CARLA vehicle blueprint: {blueprint_id}") from error
        if blueprint.has_attribute("role_name"): blueprint.set_attribute("role_name", role_name)
        actor = self.world.try_spawn_actor(blueprint, transform)
        if actor is None: raise RuntimeError(f"Could not spawn {blueprint_id}")
        return actor

    def _spawn_traffic(self, configuration: dict[str, Any], spawn_points: list[Any]) -> None:
        count = min(configuration["trafficConfig"]["npcVehicleCount"], len(spawn_points))
        blueprints = list(self.world.get_blueprint_library().filter("vehicle.*"))
        randomizer = random.Random(configuration["randomSeed"])
        for index in range(count):
            blueprint = randomizer.choice(blueprints)
            if blueprint.has_attribute("role_name"): blueprint.set_attribute("role_name", "autopilot")
            actor = self.world.try_spawn_actor(blueprint, spawn_points[index])
            if actor is None: continue
            self.vehicles.append(actor)
            actor.set_autopilot(True, self.traffic_manager.get_port())
            self._apply_speed_limit_override(actor, configuration["trafficConfig"].get("speedLimitOverride"))

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
                    self.events.put({"type":"simulator.collision","otherActor":str(data.other_actor.type_id),"impulse":math.sqrt(impulse.x**2+impulse.y**2+impulse.z**2)})
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
        if self.active_configuration is None: return
        session_id = self.active_configuration["sessionId"]
        suffix = "png" if sensor_type.startswith("sensor.camera.") else "ply"
        relative = Path(session_id) / sensor_id / f"{int(data.frame):010d}.{suffix}"
        target = self.settings.media_directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        data.save_to_disk(str(target))
        self.events.put({
            "type":"simulator.sensor_artifact",
            "sensorId":sensor_id,
            "kind":"camera" if suffix == "png" else "lidar",
            "frame":int(data.frame),
            "reference":f"carla://{relative.as_posix()}",
            "metadata":{},
        })

    def _configure_spectator(self, configuration: dict[str, Any]) -> None:
        if not configuration.get("enabled", True) or self.ego_vehicle is None: return
        vehicle = self.ego_vehicle.get_transform()
        transform = carla.Transform(
            carla.Location(x=vehicle.location.x + float(configuration.get("x", -6)), y=vehicle.location.y + float(configuration.get("y", 0)), z=vehicle.location.z + float(configuration.get("z", 4))),
            carla.Rotation(pitch=float(configuration.get("pitch", -15)), yaw=vehicle.rotation.yaw + float(configuration.get("yaw", 0)), roll=float(configuration.get("roll", 0))),
        )
        self.world.get_spectator().set_transform(transform)

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
        if self.ego_vehicle is None: raise RuntimeError("The ego vehicle is unavailable")
        self.ego_vehicle.apply_control(carla.VehicleControl(throttle=float(throttle), steer=float(steer), brake=float(brake)))

    def _enforce_control_timeout(self) -> None:
        elapsed = (time.monotonic() - self.last_control_at) * 1_000
        if elapsed <= self.settings.control_timeout_milliseconds or self.control_safe: return
        self._apply_vehicle_control(0.0, 0.0, 1.0)
        self.control_safe = True
        self.events.put({"type":"adapter.error","code":"CONTROL_INPUT_STALE","message":"Real-time vehicle control timed out; the safety brake was applied.","fatal":False,"details":{}})

    def _cleanup(self, restore_settings: bool) -> None:
        for controller in self.walker_controllers:
            try: controller.stop()
            except Exception: pass
        for sensor in self.sensors:
            try: sensor.stop()
            except Exception: pass
        for actor in [*self.sensors, *self.walker_controllers, *self.walkers, *reversed(self.vehicles)]:
            try: actor.destroy()
            except Exception: pass
        if self.traffic_manager is not None:
            try: self.traffic_manager.set_synchronous_mode(False)
            except Exception: pass
        if restore_settings and self.world is not None and self.original_settings is not None:
            try: self.world.apply_settings(self.original_settings)
            except Exception: pass
        self.sensors = []; self.walker_controllers = []; self.walkers = []; self.vehicles = []
        self.ego_vehicle = None; self.traffic_manager = None; self.original_settings = None
        self.active_configuration = None; self.paused = False
        self.recording_path = None; self.recording_active = False

    @staticmethod
    def _vector(value: Any) -> dict[str, float]:
        return {"x":float(value.x),"y":float(value.y),"z":float(value.z)}

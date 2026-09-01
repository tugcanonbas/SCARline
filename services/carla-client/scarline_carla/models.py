from __future__ import annotations

from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any
from uuid import UUID, uuid4


def timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def protocol_message(message_type: str, **fields: Any) -> dict[str, Any]:
    return {
        "version": 1,
        "id": str(uuid4()),
        "timestamp": timestamp(),
        "type": message_type,
        **fields,
    }


def require_uuid(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a UUID")
    try:
        UUID(value)
    except ValueError as error:
        raise ValueError(f"{field} must be a UUID") from error
    return value


def require_number(value: Any, field: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    result = float(value)
    if result < minimum or result > maximum:
        raise ValueError(f"{field} must be between {minimum} and {maximum}")
    return result


def safe_relative_directory(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("recordingConfig.directory must be a relative path or null")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("recordingConfig.directory must stay inside the CARLA media directory")
    return str(path)


def validate_carla_configuration(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("CARLA configuration must be an object")
    required = {
        "map", "weatherPreset", "weatherCustom", "egoVehicleBlueprint",
        "simulationMode", "fixedDeltaSeconds", "controlMode", "randomSeed",
        "trafficConfig", "pedestrianConfig", "sunConfig", "spectatorConfig",
        "recordingConfig", "sensors",
    }
    unknown = set(value) - required
    missing = required - set(value)
    if missing: raise ValueError(f"CARLA configuration is missing: {', '.join(sorted(missing))}")
    if unknown: raise ValueError(f"CARLA configuration has unknown fields: {', '.join(sorted(unknown))}")
    if not isinstance(value["map"], str) or not value["map"].strip(): raise ValueError("map is required")
    if value["weatherPreset"] is not None and (not isinstance(value["weatherPreset"], str) or not value["weatherPreset"].strip()): raise ValueError("weatherPreset is invalid")
    if value["simulationMode"] != "synchronous" or value["fixedDeltaSeconds"] != 0.05:
        raise ValueError("CARLA must use synchronous mode with fixedDeltaSeconds 0.05")
    if value["controlMode"] not in {"io", "autopilot", "external"}: raise ValueError("controlMode is invalid")
    if not isinstance(value["randomSeed"], int) or isinstance(value["randomSeed"], bool) or not 0 <= value["randomSeed"] <= 2_147_483_647:
        raise ValueError("randomSeed is invalid")
    if not isinstance(value["egoVehicleBlueprint"], str) or not value["egoVehicleBlueprint"].startswith("vehicle."):
        raise ValueError("egoVehicleBlueprint is invalid")
    for key in ("weatherCustom", "trafficConfig", "pedestrianConfig", "sunConfig", "spectatorConfig", "recordingConfig"):
        if not isinstance(value[key], dict): raise ValueError(f"{key} must be an object")
    traffic = value["trafficConfig"]
    pedestrians = value["pedestrianConfig"]
    if not isinstance(traffic.get("npcVehicleCount"), int) or not 0 <= traffic["npcVehicleCount"] <= 200: raise ValueError("npcVehicleCount is invalid")
    if not isinstance(pedestrians.get("pedestrianCount"), int) or not 0 <= pedestrians["pedestrianCount"] <= 200: raise ValueError("pedestrianCount is invalid")
    require_number(traffic.get("speedDifference"), "trafficConfig.speedDifference", -100, 100)
    if traffic.get("speedLimitOverride") is not None:
        require_number(traffic.get("speedLimitOverride"), "trafficConfig.speedLimitOverride", 0, 300)
    weather = value["weatherCustom"]
    require_number(weather.get("cloudiness"), "weatherCustom.cloudiness", 0, 100)
    require_number(weather.get("precipitation"), "weatherCustom.precipitation", 0, 100)
    require_number(weather.get("windIntensity"), "weatherCustom.windIntensity", 0, 100)
    require_number(value["sunConfig"].get("sunAltitudeAngle"), "sunConfig.sunAltitudeAngle", -90, 90)
    spectator = value["spectatorConfig"]
    if not isinstance(spectator.get("enabled"), bool): raise ValueError("spectatorConfig.enabled must be a boolean")
    for key in ("x", "y", "z", "pitch", "yaw", "roll"): require_number(spectator.get(key), f"spectatorConfig.{key}", -100_000, 100_000)
    recording = value["recordingConfig"]
    if not isinstance(recording.get("enabled"), bool): raise ValueError("recordingConfig.enabled must be a boolean")
    sensors = value["sensors"]
    if not isinstance(sensors, list) or len(sensors) > 100: raise ValueError("sensors must contain at most 100 entries")
    identifiers: set[str] = set()
    for sensor in sensors:
        if not isinstance(sensor, dict): raise ValueError("sensor configuration must be an object")
        if set(sensor) != {"type", "id", "attributes", "transform"}: raise ValueError("sensor configuration fields are invalid")
        if not isinstance(sensor["type"], str) or not sensor["type"].startswith("sensor."): raise ValueError("sensor type is invalid")
        if not isinstance(sensor["id"], str) or not sensor["id"]: raise ValueError("sensor id is invalid")
        if sensor["id"] in identifiers: raise ValueError(f"duplicate sensor id: {sensor['id']}")
        identifiers.add(sensor["id"])
        if not isinstance(sensor["attributes"], dict) or not isinstance(sensor["transform"], dict): raise ValueError("sensor attributes and transform must be objects")
        for key in ("x", "y", "z"): require_number(sensor["transform"].get(key), f"sensor {sensor['id']} transform.{key}", -100_000, 100_000)
        for key in ("pitch", "yaw", "roll"):
            if key in sensor["transform"]: require_number(sensor["transform"][key], f"sensor {sensor['id']} transform.{key}", -360, 360)
    result = dict(value)
    result["recordingConfig"] = dict(value["recordingConfig"])
    result["recordingConfig"]["directory"] = safe_relative_directory(value["recordingConfig"].get("directory"))
    return result


def validate_session_configuration(message: dict[str, Any]) -> dict[str, Any]:
    if message.get("simulatorType") != "carla": raise ValueError("CARLA adapter only accepts simulatorType carla")
    sequence = message.get("sequence")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0: raise ValueError("sequence must be a non-negative integer")
    return {
        "studyId": require_uuid(message.get("studyId"), "studyId"),
        "sessionId": require_uuid(message.get("sessionId"), "sessionId"),
        "sessionConditionId": require_uuid(message.get("sessionConditionId"), "sessionConditionId"),
        "sequence": sequence,
        "simulatorType": "carla",
        "configuration": validate_carla_configuration(message.get("configuration")),
    }

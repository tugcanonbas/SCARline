from __future__ import annotations

import importlib.metadata
import json
from pathlib import Path
from typing import Any

from .drivers import DRIVER_TYPES, SensorDriver


def load_manifests(directory: Path) -> dict[str, dict[str, Any]]:
    manifests: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("*.json")):
        value = json.loads(path.read_text(encoding="utf8"))
        key = value.get("key")
        if not isinstance(key, str) or not key: raise ValueError(f"Invalid driver manifest: {path}")
        if key in manifests: raise ValueError(f"Duplicate driver key: {key}")
        manifests[key] = value
    return manifests


def discover_driver_types() -> dict[str, type[SensorDriver]]:
    result = dict(DRIVER_TYPES)
    for entry in importlib.metadata.entry_points(group="scarline_io.drivers"):
        loaded = entry.load()
        if not isinstance(loaded, type) or not issubclass(loaded, SensorDriver):
            raise TypeError(f"Driver entry point {entry.name} is not a SensorDriver")
        result[entry.name] = loaded
    return result

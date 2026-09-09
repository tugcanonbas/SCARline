from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class Settings:
    repository_root: Path
    bridge_url: str
    adapter_secret: str
    adapter_id: str
    priority: int
    expected_carla_version: str
    carla_host: str
    carla_port: int
    health_port: int
    reconnect_interval: int
    reconnect_grace: int
    maximum_message_bytes: int
    command_journal: Path
    media_directory: Path
    control_timeout_milliseconds: int


def _inside(repository_root: Path, runtime_root: Path, value: str, label: str) -> Path:
    target = (repository_root / value).resolve()
    try: target.relative_to(runtime_root)
    except ValueError as error: raise ValueError(f"{label} must resolve inside platform.runtime_directory") from error
    return target


def load_settings(config_path: Path, repository_root: Path) -> Settings:
    values = yaml.safe_load(config_path.read_text(encoding="utf8"))
    if not isinstance(values, dict): raise ValueError("config.yml must contain an object")
    secret = os.environ.get("SIM_BRIDGE_ADAPTER_SECRET", "")
    if len(secret) < 32: raise ValueError("SIM_BRIDGE_ADAPTER_SECRET must contain at least 32 characters")
    bridge: dict[str, Any] = values["sim_bridge"]
    carla: dict[str, Any] = values["simulator"]["carla"]
    runtime = (repository_root / values["platform"]["runtime_directory"]).resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    journal = _inside(repository_root, runtime, carla["command_journal"], "simulator.carla.command_journal")
    media = _inside(repository_root, runtime, carla["media_directory"], "simulator.carla.media_directory")
    return Settings(
        repository_root=repository_root,
        bridge_url=f"ws://{bridge['host']}:{bridge['port']}{bridge['adapter_path']}",
        adapter_secret=secret,
        adapter_id=carla["adapter_id"],
        priority=int(carla["priority"]),
        expected_carla_version=str(carla["version"]),
        carla_host=carla["host"],
        carla_port=int(carla["port"]),
        health_port=int(carla["health_port"]),
        reconnect_interval=int(carla["reconnect_interval_seconds"]),
        reconnect_grace=int(bridge["adapter_reconnect_grace_seconds"]),
        maximum_message_bytes=int(bridge["maximum_websocket_message_bytes"]),
        command_journal=journal,
        media_directory=media,
        control_timeout_milliseconds=int(carla["control_timeout_milliseconds"]),
    )

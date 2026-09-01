from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class CommandJournal:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.results: dict[str, dict[str, Any]] = {}
        self.active_configuration: dict[str, Any] | None = None
        self.paused = False
        self._load()

    def _load(self) -> None:
        try:
            value = json.loads(self.path.read_text(encoding="utf8"))
            if value.get("version") != 1: return
            self.results = value.get("results", {})
            self.active_configuration = value.get("activeConfiguration")
            self.paused = value.get("paused") is True
        except (FileNotFoundError, json.JSONDecodeError, OSError, AttributeError):
            return

    def get(self, command_id: str) -> dict[str, Any] | None:
        return self.results.get(command_id)

    def record(
        self,
        command_id: str,
        result: dict[str, Any],
        active_configuration: dict[str, Any] | None,
        paused: bool,
    ) -> None:
        self.results[command_id] = result
        if len(self.results) > 2_000: self.results = dict(list(self.results.items())[-1_000:])
        self.active_configuration = active_configuration
        self.paused = paused
        self._write()

    def set_state(self, active_configuration: dict[str, Any] | None, paused: bool) -> None:
        self.active_configuration = active_configuration
        self.paused = paused
        self._write()

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps({
            "version": 1,
            "results": self.results,
            "activeConfiguration": self.active_configuration,
            "paused": self.paused,
        }, separators=(",", ":")), encoding="utf8")
        temporary.replace(self.path)

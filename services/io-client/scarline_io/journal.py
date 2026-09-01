from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class CommandJournal:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.records: dict[str, dict[str, Any]] = {}
        if path.exists():
            try: self.records = json.loads(path.read_text(encoding="utf8"))
            except Exception: self.records = {}

    def get(self, command_id: str) -> dict[str, Any] | None: return self.records.get(command_id)

    def finish(self, command_id: str, acknowledgement: dict[str, Any]) -> None:
        self.records[command_id] = acknowledgement
        if len(self.records) > 2_000:
            self.records = dict(list(self.records.items())[-1_000:])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.records, separators=(",", ":")), encoding="utf8")
        temporary.replace(self.path)

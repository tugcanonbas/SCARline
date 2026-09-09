from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


def timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def envelope(
    routing_key: str,
    payload: dict[str, Any],
    *,
    study_id: str | None = None,
    session_id: str | None = None,
    correlation_id: str | None = None,
    instance_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "timestamp": timestamp(),
        "routingKey": routing_key,
        "producer": "io-client",
        "payload": payload,
        "metadata": {
            "studyId": study_id,
            "sessionId": session_id,
            "correlationId": correlation_id,
            "source": {"component": "io-client", "instanceId": instance_id},
        },
    }


@dataclass(frozen=True)
class Reading:
    channel: str
    sample: dict[str, Any]
    source_timestamp: str = field(default_factory=timestamp)
    dropped_samples: int = 0

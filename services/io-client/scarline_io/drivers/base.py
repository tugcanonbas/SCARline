from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..models import Reading


class SensorDriver(ABC):
    """Async boundary implemented by every trusted SCARline sensor package."""

    key: str

    def __init__(self) -> None:
        self.configuration: dict[str, Any] = {}
        self.connected = False
        self.running = False

    async def configure(self, configuration: dict[str, Any]) -> None:
        self.configuration = dict(configuration)

    @abstractmethod
    async def connect(self) -> None: ...

    async def start(self) -> None:
        self.running = True

    async def pause(self) -> None:
        self.running = False

    async def resume(self) -> None:
        self.running = True

    @abstractmethod
    async def read(self, channel: str) -> Reading | None: ...

    async def get_state(self) -> dict[str, Any]:
        return {"driverKey": self.key, "connected": self.connected, "running": self.running}

    @abstractmethod
    async def disconnect(self) -> None: ...

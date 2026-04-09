from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SensorMetadata:
    driver_id: str
    sensor_type: str
    display_name: str
    version: str
    sample_rate: int
    custom_fields: dict[str, Any] = field(default_factory=dict)


@dataclass
class SensorReading:
    timestamp: float
    data: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)


class SensorDriver(ABC):
    @abstractmethod
    def get_metadata(self) -> SensorMetadata:
        raise NotImplementedError

    @abstractmethod
    def initialize(self, config: dict[str, Any]) -> bool:
        raise NotImplementedError

    @abstractmethod
    def start(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def stop(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def read(self) -> SensorReading | None:
        raise NotImplementedError

    @abstractmethod
    def calibrate(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def is_connected(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def shutdown(self) -> None:
        raise NotImplementedError

    def get_configurable_fields(self) -> dict[str, Any]:
        return {}

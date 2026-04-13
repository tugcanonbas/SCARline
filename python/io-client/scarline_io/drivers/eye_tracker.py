from __future__ import annotations

import time
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading


class EyeTrackerDriver(SensorDriver):
    def __init__(self) -> None:
        self.sample_rate = 60
        self.active = False
        self.connected = False

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="eye_tracker",
            sensor_type="eye_tracker",
            display_name="Baseline Eye Tracker Interface",
            version="0.1.0",
            sample_rate=self.sample_rate,
            custom_fields={"driverClass": "baseline"},
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(config.get("sample_rate", config.get("sampleRate", 60)))
        self.connected = False
        return False

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        return SensorReading(
            timestamp=time.time(),
            data={
                "gaze": {"x": None, "y": None},
                "pupilDiameter": None,
                "connected": False,
            },
            metadata={"source": "baseline-unavailable"},
        )

    def calibrate(self) -> bool:
        return False

    def is_connected(self) -> bool:
        return self.connected

    def shutdown(self) -> None:
        self.connected = False



from __future__ import annotations

import time
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None


class UsbCameraDriver(SensorDriver):
    def __init__(self) -> None:
        self.sample_rate = 30
        self.device_index = 0
        self.capture = None
        self.active = False

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="usb_camera",
            sensor_type="camera",
            display_name="USB Camera",
            version="0.1.0",
            sample_rate=self.sample_rate,
            custom_fields={"device_index": self.device_index},
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(config.get("sample_rate", 30))
        self.device_index = int(config.get("device_index", 0))
        if cv2 is None:
            return False
        try:
            self.capture = cv2.VideoCapture(self.device_index)
            return bool(self.capture and self.capture.isOpened())
        except Exception:
            self.capture = None
            return False

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        if self.capture is None:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "sensorId": "usb_camera",
                    "frameWidth": 0,
                    "frameHeight": 0,
                    "dataRef": "camera-unavailable"
                },
                metadata={"connected": False},
            )

        ok, frame = self.capture.read()
        if not ok:
            return None
        height, width = frame.shape[:2]
        return SensorReading(
            timestamp=time.time(),
            data={
                "sensorId": "usb_camera",
                "frameWidth": width,
                "frameHeight": height,
                "dataRef": "embedded-webcam-frame"
            },
            metadata={"connected": True},
        )

    def calibrate(self) -> bool:
        return True

    def is_connected(self) -> bool:
        return bool(self.capture and self.capture.isOpened())

    def shutdown(self) -> None:
        if self.capture is not None:
          self.capture.release()
        self.capture = None

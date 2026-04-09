from __future__ import annotations

import time
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading

try:
    import evdev  # type: ignore
except Exception:  # pragma: no cover
    evdev = None


class LogitechG29Driver(SensorDriver):
    def __init__(self) -> None:
        self.sample_rate = 100
        self.device_path = "/dev/input/event0"
        self.device = None
        self.active = False
        self.state = {
          "steer": 0.0,
          "throttle": 0.0,
          "brake": 0.0,
          "clutch": 0.0,
          "gear": 1,
          "buttons": {}
        }

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="logitech_g29",
            sensor_type="steering_wheel",
            display_name="Logitech G29 Steering Wheel",
            version="0.1.0",
            sample_rate=self.sample_rate,
            custom_fields={"device_path": self.device_path},
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(config.get("sample_rate", 100))
        self.device_path = str(config.get("device_path", self.device_path))

        if evdev is None:
            return False

        try:
            self.device = evdev.InputDevice(self.device_path)
            self.device.grab()
            return True
        except Exception:
            self.device = None
            return False

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        if self.device is None:
            return SensorReading(
                timestamp=time.time(),
                data=self.state | {"connected": False},
                metadata={"source": "stub"},
            )

        try:
            for event in self.device.read():
                if event.type == evdev.ecodes.EV_ABS:
                    if event.code == evdev.ecodes.ABS_X:
                        self.state["steer"] = round((event.value - 32767) / 32767, 4)
                    if event.code == evdev.ecodes.ABS_Z:
                        self.state["brake"] = round(event.value / 255, 4)
                    if event.code == evdev.ecodes.ABS_RZ:
                        self.state["throttle"] = round(event.value / 255, 4)
                if event.type == evdev.ecodes.EV_KEY:
                    self.state["buttons"][str(event.code)] = bool(event.value)
        except BlockingIOError:
            pass
        except Exception:
            return SensorReading(
                timestamp=time.time(),
                data=self.state | {"connected": False},
                metadata={"source": "error-fallback"},
            )

        return SensorReading(timestamp=time.time(), data=self.state.copy())

    def calibrate(self) -> bool:
        return True

    def is_connected(self) -> bool:
        return self.device is not None

    def shutdown(self) -> None:
        if self.device is not None:
            try:
                self.device.ungrab()
                self.device.close()
            except Exception:
                pass
        self.device = None

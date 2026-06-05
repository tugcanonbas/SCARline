from __future__ import annotations

import threading
import time
import asyncio
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading

try:
    from bleak import BleakScanner, BleakClient  # type: ignore
except Exception:  # pragma: no cover
    BleakScanner = None
    BleakClient = None

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None

# Bluetooth SIG Heart Rate Service UUID 0x180D
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
# Bluetooth SIG Heart Rate Measurement Characteristic UUID 0x2A37
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"


class HeartRateDriver(SensorDriver):
    """Heart rate monitor driver supporting BLE (Bluetooth SIG Heart Rate Service UUID 0x180D, Heart Rate Measurement Characteristic UUID 0x2A37) and fallback serial with format BPM:<valor>."""

    def __init__(self) -> None:
        self.sample_rate = 1
        self.active = False
        self.connected = False
        self.backend = "bleak"
        self._serial_port: Any = None
        self._ble_thread: threading.Thread | None = None
        self._ble_stop_event = threading.Event()
        self._last_bpm: float | None = None
        self._last_rr: float | None = None

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="heart_rate",
            sensor_type="heart_rate",
            display_name="Heart Rate Monitor",
            version="1.0.0",
            sample_rate=self.sample_rate,
            custom_fields={
                "driverClass": "heart_rate",
                "backend": self.backend,
            },
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(config.get("sample_rate", config.get("sampleRate", 1)))
        self.backend = config.get("backend", "bleak")

        if self.backend == "serial":
            if serial is None:
                self.connected = False
                return False
            port = config.get("serial_port", "COM3")
            baud = int(config.get("serial_baud", 9600))
            try:
                self._serial_port = serial.Serial(port, baud, timeout=1)
                self.connected = True
                return True
            except Exception:
                self.connected = False
                return False
        else:
            if BleakScanner is None or BleakClient is None:
                self.connected = False
                return False
            try:
                device = asyncio.run(self._discover_ble_device())
                if device:
                    self._ble_stop_event.clear()
                    self._ble_thread = threading.Thread(target=self._run_ble_loop_sync, args=(device,), daemon=True)
                    self._ble_thread.start()
                    self.connected = True
                    return True
                else:
                    self.connected = False
                    return False
            except Exception:
                self.connected = False
                return False

    async def _discover_ble_device(self) -> Any:
        # short timeout for discovery during init
        devices = await BleakScanner.discover(timeout=2.0)
        for d in devices:
            if d.metadata and "uuids" in d.metadata:
                if HR_SERVICE_UUID in d.metadata["uuids"]:
                    return d
        return None

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        if not self.connected:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "heartRateBpm": None,
                    "rrIntervalMs": None,
                    "connected": False,
                },
                metadata={"source": "baseline-unavailable"},
            )

        if self.backend == "serial" and self._serial_port:
            try:
                if self._serial_port.in_waiting > 0:
                    line = self._serial_port.readline().decode("ascii", errors="ignore").strip()
                    if line.startswith("BPM:"):
                        try:
                            self._last_bpm = float(line.split(":")[1])
                        except ValueError:
                            pass
            except Exception:
                pass
            
            return SensorReading(
                timestamp=time.time(),
                data={
                    "heartRateBpm": self._last_bpm,
                    "rrIntervalMs": self._last_rr,
                    "connected": True,
                },
                metadata={"source": "serial"},
            )
            
        elif self.backend == "bleak" and self.connected:
                
            return SensorReading(
                timestamp=time.time(),
                data={
                    "heartRateBpm": self._last_bpm,
                    "rrIntervalMs": self._last_rr,
                    "connected": True,
                },
                metadata={"source": "bleak"},
            )

        # Fallback
        return SensorReading(
            timestamp=time.time(),
            data={
                "heartRateBpm": None,
                "rrIntervalMs": None,
                "connected": False,
            },
            metadata={"source": "baseline-unavailable"},
        )

    def _run_ble_loop_sync(self, device: Any) -> None:
        asyncio.run(self._ble_loop(device))

    async def _ble_loop(self, device: Any) -> None:
        client = BleakClient(device)
        try:
            await client.connect()
            delay = 1.0 / max(self.sample_rate, 1)
            while not self._ble_stop_event.is_set():
                if client.is_connected:
                    try:
                        data = await client.read_gatt_char(HR_MEASUREMENT_UUID)
                        flags = data[0]
                        # bit 0 = Heart Rate Value Format (0 = 8-bit BPM, 1 = 16-bit BPM)
                        if flags & 0x01:
                            self._last_bpm = float(int.from_bytes(data[1:3], byteorder="little"))
                            offset = 3
                        else:
                            self._last_bpm = float(data[1])
                            offset = 2
                        
                        # bit 4 = RR-Interval (0 = not present, 1 = present)
                        if flags & 0x10 and len(data) >= offset + 2:
                            rr = int.from_bytes(data[offset:offset+2], byteorder="little")
                            self._last_rr = float((rr / 1024.0) * 1000.0)
                    except Exception:
                        pass
                await asyncio.sleep(delay)
        finally:
            if client.is_connected:
                await client.disconnect()
    def calibrate(self) -> bool:
        return self.connected

    def is_connected(self) -> bool:
        return self.connected

    def shutdown(self) -> None:
        self.active = False
        self.connected = False
        if self.backend == "serial" and self._serial_port:
            try:
                self._serial_port.close()
            except Exception:
                pass
            self._serial_port = None
        elif self.backend == "bleak":
            self._ble_stop_event.set()
            if self._ble_thread is not None:
                self._ble_thread.join(timeout=2.0)
                self._ble_thread = None

    def get_configurable_fields(self) -> dict[str, Any]:
        return {
            "backend": {"type": "string", "default": "bleak", "description": "Backend (bleak or serial)"},
            "sample_rate": {"type": "integer", "default": 1, "description": "Sample rate (Hz)"},
            "serial_port": {"type": "string", "default": "COM3", "description": "Serial port for serial backend"},
            "serial_baud": {"type": "integer", "default": 9600, "description": "Baud rate for serial backend"},
        }

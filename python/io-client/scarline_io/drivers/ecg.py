from __future__ import annotations

import threading
import time
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading

try:
    import sifi_bridge_py as sbp  # type: ignore

    SIFI_AVAILABLE = True
except Exception:  # pragma: no cover
    sbp = None
    SIFI_AVAILABLE = False


class ECGDriver(SensorDriver):
    """ECG waveform driver using SiFi Bridge BLE (BioPoint / BioArmband).

    Connects via ``sifi-bridge-py`` to a SiFi Labs device, configures the
    onboard ECG front-end, and drains ECG packets in a background thread.
    When the SDK or hardware is unavailable the driver operates in degraded
    mode, returning stub readings with ``connected: False``.
    """

    def __init__(self) -> None:
        self.sample_rate = 500
        self.connected = False
        self._sb: Any = None
        self._last_packet: dict[str, Any] | None = None
        self._ecg_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------
    # SensorDriver interface
    # ------------------------------------------------------------------

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="ecg",
            sensor_type="ecg",
            display_name="SiFi Labs ECG",
            version="1.0.0",
            sample_rate=self.sample_rate,
            custom_fields={
                "driverClass": "ecg",
                "backend": "sifi-bridge",
            },
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(
            config.get("sample_rate", config.get("sampleRate", 500))
        )

        if not SIFI_AVAILABLE:
            self.connected = False
            return False

        try:
            self._sb = sbp.SifiBridge()

            mac = config.get("mac")
            if mac:
                connected = self._sb.connect(mac)
            else:
                connected = self._sb.connect()

            if not connected:
                self.connected = False
                return False

            mains_notch = int(config.get("mains_notch", config.get("mainsNotch", 50)))
            flo = int(config.get("flo", 0))
            fhi = int(config.get("fhi", 30))

            # Enable the ECG channel in the SDK
            self._sb.set_channels(ecg=True)
            # Configure sampling frequency
            self._sb.configure_sampling_freqs(ecg=self.sample_rate)
            # Configure bandpass frequencies
            self._sb.configure_ecg(bandpass_freqs=(flo, fhi))
            
            self._sb.start()
            time.sleep(0.5)

            self._stop_event.clear()
            self._ecg_thread = threading.Thread(
                target=self._drain_loop, daemon=True
            )
            self._ecg_thread.start()
            self.connected = True
            return True
        except Exception as e:
            print(f"[ECG DRIVER] initialize() failed: {type(e).__name__}: {e}")
            self.connected = False
            return False

    def start(self) -> None:
        # Activation happens in initialize(); start() is a no-op.
        pass

    def stop(self) -> None:
        self._stop_event.set()
        if self._ecg_thread is not None:
            self._ecg_thread.join(timeout=2.0)
            self._ecg_thread = None
        if self._sb is not None and self.connected:
            try:
                self._sb.stop()
            except Exception:
                pass

    def read(self) -> SensorReading | None:
        if not self.connected or self._last_packet is None:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "ecgSamples": None,
                    "sampleRate": None,
                    "dataLostCount": None,
                    "connected": False,
                },
                metadata={"source": "baseline-unavailable"},
            )

        p = self._last_packet
        data_lost = 0
        if isinstance(p.get("data_lost_count"), dict):
            data_lost = p["data_lost_count"].get("ecg", 0)

        return SensorReading(
            timestamp=p.get("timestamp", time.time()),
            data={
                "ecgSamples": p["data"]["ecg"],
                "sampleRate": p.get("sample_rate", self.sample_rate),
                "dataLostCount": data_lost,
                "connected": True,
            },
            metadata={
                "source": "sifi-bridge",
                "device": p.get("device", "unknown"),
            },
        )

    def calibrate(self) -> bool:
        return True  # ECG does not require calibration

    def is_connected(self) -> bool:
        return self.connected

    def shutdown(self) -> None:
        self.stop()
        if self._sb is not None and self.connected:
            try:
                self._sb.disconnect()
            except Exception:
                pass
            time.sleep(0.5)
        self.connected = False

    def get_configurable_fields(self) -> dict[str, Any]:
        return {
            "mac": {
                "type": "string",
                "default": "",
                "description": "Optional BLE MAC address of the SiFi device",
            },
            "sample_rate": {
                "type": "integer",
                "default": 500,
                "description": "ECG sampling rate in Hz (250, 500, 1000)",
            },
            "mains_notch": {
                "type": "integer",
                "default": 50,
                "description": "Mains notch filter frequency (50 or 60 Hz)",
            },
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _drain_loop(self) -> None:
        """Background thread: pull ECG packets from the SiFi Bridge queue."""
        while not self._stop_event.is_set():
            try:
                packet = self._sb.get_ecg()
                if packet:
                    self._last_packet = packet
            except Exception:
                pass

"""Standalone ECG demo -- publishes synthetic or live SiFi Bridge ECG data.

Usage:
    python demo_ecg.py --dry-run   # stub mode, synthetic ECG waveform
    python demo_ecg.py             # real SiFi Bridge BLE + RabbitMQ
    python demo_ecg.py --mac AA:BB:CC:DD:EE:FF   # specify BLE MAC
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import json
import math
import os
import sys
import time
import uuid
import webbrowser

# Ensure scarline_io package is importable
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

STUDY_ID = "system"
RUN_ID = "global"
ECG_ROUTING_KEY = f"events.{STUDY_ID}.{RUN_ID}.sensor.io.ecg"
HR_ROUTING_KEY = f"events.{STUDY_ID}.{RUN_ID}.sensor.io.heart_rate"
EXCHANGE_NAME = "scarline.events"


# ---------------------------------------------------------------------------
# BPM Estimator — lightweight Pan-Tompkins-inspired R-peak detector
# ---------------------------------------------------------------------------

class BPMEstimator:
    """Estimate heart rate (BPM) from raw ECG samples using R-peak detection.

    Algorithm:
      1. Feed raw ECG samples via ``add_samples()``.
      2. Compute a simple moving-average baseline and subtract it (detrend).
      3. Detect R-peaks as local maxima exceeding a dynamic threshold
         with a minimum refractory gap of 200 ms between peaks.
      4. BPM = 60 / mean(R-R intervals) over the last N peaks.
    """

    def __init__(self, *, window_sec: float = 5.0, refractory_ms: float = 200.0) -> None:
        self._sample_rate: int = 500
        self._refractory_samples: int = int(refractory_ms / 1000.0 * self._sample_rate)
        self._window_samples: int = int(window_sec * self._sample_rate)
        # Rolling buffer of raw samples
        self._buf: collections.deque[float] = collections.deque(maxlen=self._window_samples)
        # Timestamps (in sample index) of detected R-peaks
        self._peak_indices: list[int] = []
        self._total_samples: int = 0
        # Dynamic threshold (adaptive)
        self._threshold: float = 0.0

    def add_samples(self, samples: list[float], sample_rate: int = 500) -> None:
        if sample_rate != self._sample_rate:
            self._sample_rate = sample_rate
            self._refractory_samples = int(200.0 / 1000.0 * sample_rate)
            self._window_samples = int(5.0 * sample_rate)
            self._buf = collections.deque(self._buf, maxlen=self._window_samples)

        for s in samples:
            self._buf.append(s)
            self._total_samples += 1

        # Run peak detection on the full buffer
        self._detect_peaks()

    def get_bpm(self) -> float | None:
        """Return estimated BPM, or None if insufficient peaks detected."""
        # Need at least 3 R-peaks for a reliable estimate
        if len(self._peak_indices) < 3:
            return None

        # Use only the last 10 intervals for a responsive estimate
        recent = self._peak_indices[-11:]
        intervals = [recent[i + 1] - recent[i] for i in range(len(recent) - 1)]
        if not intervals:
            return None

        mean_interval = sum(intervals) / len(intervals)
        if mean_interval <= 0:
            return None

        bpm = 60.0 * self._sample_rate / mean_interval
        # Sanity clamp: 30–220 BPM
        if bpm < 30 or bpm > 220:
            return None
        return round(bpm, 1)

    def _detect_peaks(self) -> None:
        """Re-detect R-peaks in the current buffer."""
        buf = list(self._buf)
        n = len(buf)
        if n < self._sample_rate:  # Need at least 1s of data
            return

        # Simple baseline removal: subtract moving average (window ~50 samples)
        ma_win = min(50, n // 4)
        if ma_win < 3:
            return

        # Compute moving average
        cumsum = [0.0]
        for v in buf:
            cumsum.append(cumsum[-1] + v)
        baseline = [(cumsum[min(i + ma_win, n)] - cumsum[max(i - ma_win, 0)]) /
                     (min(i + ma_win, n) - max(i - ma_win, 0))
                     for i in range(n)]

        # Detrended signal
        detrended = [buf[i] - baseline[i] for i in range(n)]

        # Adaptive threshold: 60% of the max absolute value
        max_val = max(abs(v) for v in detrended) if detrended else 0
        self._threshold = max_val * 0.6
        if self._threshold < 1e-6:
            return

        # Detect peaks
        buf_start_idx = self._total_samples - n
        peaks: list[int] = []
        i = 1
        while i < n - 1:
            if (detrended[i] > self._threshold and
                    detrended[i] > detrended[i - 1] and
                    detrended[i] >= detrended[i + 1]):
                global_idx = buf_start_idx + i
                if not peaks or (global_idx - peaks[-1]) >= self._refractory_samples:
                    peaks.append(global_idx)
                    i += self._refractory_samples  # Skip refractory period
                    continue
            i += 1

        self._peak_indices = peaks


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def build_ecg_payload(*, ecg_samples: list[float], connected: bool) -> dict:
    return {
        "studyId": STUDY_ID,
        "runId": RUN_ID,
        "ecgSamples": ecg_samples,
        "connected": connected,
        "timestamp": iso_timestamp(),
    }


def build_hr_payload(*, heart_rate: float) -> dict:
    return {
        "studyId": STUDY_ID,
        "runId": RUN_ID,
        "heartRate": heart_rate,
        "connected": True,
        "timestamp": iso_timestamp(),
    }


def build_envelope(payload: dict, routing_key: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "timestamp": payload["timestamp"],
        "routingKey": routing_key,
        "producer": "io-client-demo",
        "type": "event",
        "payload": payload,
        "metadata": {
            "studyId": None,
            "runId": None,
            "correlationId": None,
        },
    }


# ---------------------------------------------------------------------------
# Synthetic ECG generator
# ---------------------------------------------------------------------------

def generate_synthetic_ecg(t_start: float, count: int = 50) -> list[float]:
    samples = []
    for i in range(count):
        t = t_start + (i * 0.002)  # 500Hz
        val = math.sin(t * 2 * math.pi * 1.2) * 0.2  # Baseline wander

        phase = (t * 1.2) % 1.0
        if 0.1 < phase < 0.15:
            val -= 0.5  # Q
        elif 0.15 <= phase < 0.2:
            val += 2.0  # R
        elif 0.2 <= phase < 0.25:
            val -= 0.8  # S
        elif 0.4 < phase < 0.5:
            val += 0.4 * math.sin((phase - 0.4) * 10 * math.pi)  # T wave

        samples.append(round(val, 4))
    return samples


# ---------------------------------------------------------------------------
# Dashboard helper
# ---------------------------------------------------------------------------

def open_dashboard(name: str = "ecg.html") -> None:
    dash_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "tools", "dashboards", name)
    )
    webbrowser.open(dash_path)


# ---------------------------------------------------------------------------
# Run modes
# ---------------------------------------------------------------------------

async def run_dry() -> None:
    """Stub mode -- publishes synthetic ECG + derived BPM to RabbitMQ."""
    print("[DEMO ECG] Stub mode -- publishing synthetic ECG data")
    import aio_pika

    amqp_url = os.environ.get("AMQP_URL", "amqp://scarline:scarline@localhost:5672/")
    try:
        connection = await aio_pika.connect_robust(amqp_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True)
    except Exception as e:
        print(f"[DEMO ECG] Failed to connect to RabbitMQ at {amqp_url}: {e}")
        return

    open_dashboard("ecg.html")

    bpm_est = BPMEstimator()
    published = 0
    t_start = 0.0
    try:
        while True:
            samples = generate_synthetic_ecg(t_start, 50)
            t_start += 0.1

            # Publish ECG waveform
            ecg_payload = build_ecg_payload(ecg_samples=samples, connected=True)
            ecg_envelope = build_envelope(ecg_payload, ECG_ROUTING_KEY)
            await exchange.publish(
                aio_pika.Message(
                    body=json.dumps(ecg_envelope).encode("utf8"),
                    content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                    message_id=ecg_envelope["id"],
                ),
                routing_key=ECG_ROUTING_KEY,
            )

            # Estimate and publish BPM
            bpm_est.add_samples(samples, 500)
            bpm = bpm_est.get_bpm()
            if bpm is not None:
                hr_payload = build_hr_payload(heart_rate=bpm)
                hr_envelope = build_envelope(hr_payload, HR_ROUTING_KEY)
                await exchange.publish(
                    aio_pika.Message(
                        body=json.dumps(hr_envelope).encode("utf8"),
                        content_type="application/json",
                        message_id=hr_envelope["id"],
                    ),
                    routing_key=HR_ROUTING_KEY,
                )

            published += 1
            if published % 100 == 0:
                print(f"[DEMO ECG] Published {published} ECG packets | BPM: {bpm or '—'}")
            await asyncio.sleep(0.1)
    except KeyboardInterrupt:
        pass
    finally:
        await connection.close()


async def run_live(mac: str | None = None) -> None:
    """Live mode -- SiFi Bridge BLE hardware + RabbitMQ publish."""
    import aio_pika

    from scarline_io.drivers.ecg import ECGDriver

    amqp_url = os.environ.get("AMQP_URL", "amqp://scarline:scarline@localhost:5672/")

    print("[DEMO ECG] Initializing SiFi Bridge ECG driver...")
    driver = ECGDriver()
    config: dict = {"sample_rate": 500}
    if mac:
        config["mac"] = mac
        print(f"[DEMO ECG] Using MAC address: {mac}")
    else:
        print("[DEMO ECG] No MAC specified — scanning for SiFi device...")

    ok = driver.initialize(config)
    if not ok:
        print("[DEMO ECG] ERROR: Failed to initialize ECG driver.", file=sys.stderr)
        print("[DEMO ECG] Check that:", file=sys.stderr)
        print("  1. sifi-bridge-py is installed (pip install sifi-bridge-py)", file=sys.stderr)
        print("  2. The SiFi device is powered on and in range", file=sys.stderr)
        print("  3. Bluetooth is enabled on this machine", file=sys.stderr)
        sys.exit(1)

    print("[DEMO ECG] SiFi Bridge connected! Starting ECG stream...")

    open_dashboard("ecg.html")

    try:
        connection = await aio_pika.connect_robust(amqp_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True)
    except Exception as e:
        print(f"[DEMO ECG] Failed to connect to RabbitMQ at {amqp_url}: {e}", file=sys.stderr)
        driver.shutdown()
        sys.exit(1)

    print(f"[DEMO ECG] RabbitMQ connected. Publishing ECG to {ECG_ROUTING_KEY}")
    print(f"[DEMO ECG] BPM will publish to {HR_ROUTING_KEY}")

    bpm_est = BPMEstimator()
    published = 0
    empty_reads = 0
    try:
        while True:
            reading = driver.read()
            if reading is not None:
                data = reading.data
                samples = data.get("ecgSamples")
                connected = data.get("connected", False)

                if not connected:
                    empty_reads += 1
                    if empty_reads % 200 == 1:
                        print("[DEMO ECG] Waiting for ECG data...")
                    await asyncio.sleep(0.05)
                    continue

                if samples and connected:
                    # Publish ECG waveform
                    ecg_payload = build_ecg_payload(ecg_samples=samples, connected=True)
                    ecg_envelope = build_envelope(ecg_payload, ECG_ROUTING_KEY)
                    await exchange.publish(
                        aio_pika.Message(
                            body=json.dumps(ecg_envelope).encode("utf8"),
                            content_type="application/json",
                            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                            message_id=ecg_envelope["id"],
                        ),
                        routing_key=ECG_ROUTING_KEY,
                    )

                    # Estimate and publish BPM
                    sr = data.get("sampleRate", 500) or 500
                    bpm_est.add_samples(samples, sr)
                    bpm = bpm_est.get_bpm()
                    if bpm is not None:
                        hr_payload = build_hr_payload(heart_rate=bpm)
                        hr_envelope = build_envelope(hr_payload, HR_ROUTING_KEY)
                        await exchange.publish(
                            aio_pika.Message(
                                body=json.dumps(hr_envelope).encode("utf8"),
                                content_type="application/json",
                                message_id=hr_envelope["id"],
                            ),
                            routing_key=HR_ROUTING_KEY,
                        )

                    published += 1
                    if published % 50 == 0:
                        print(f"[DEMO ECG] Published {published} packets ({len(samples)} samples/pkt) | BPM: {bpm or '—'}")
            else:
                empty_reads += 1
            await asyncio.sleep(0.01)
    except KeyboardInterrupt:
        print(f"\n[DEMO ECG] Stopped. Total packets published: {published}")
    finally:
        driver.shutdown()
        await connection.close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="SCARline ECG demo")
    parser.add_argument("--dry-run", action="store_true", help="Stub mode publishing synthetic data")
    parser.add_argument("--mac", type=str, default=None, help="BLE MAC address of the SiFi device (optional)")
    args = parser.parse_args()

    if args.dry_run:
        await run_dry()
    else:
        await run_live(mac=args.mac)


if __name__ == "__main__":
    asyncio.run(main())

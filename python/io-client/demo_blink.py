"""Standalone blink detection demo — publishes 3 events then exits.

Usage:
    python demo_blink.py --dry-run   # stub mode, no webcam, no RabbitMQ
    python demo_blink.py             # real webcam + RabbitMQ
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid

# Ensure scarline_io package is importable when running from python/io-client/
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from scarline_io.drivers.eye_tracker import BlinkDetectionDriver


STUDY_ID = "demo"
RUN_ID = "demo"
ROUTING_KEY = f"events.{STUDY_ID}.{RUN_ID}.sensor.io.blink"
EXCHANGE_NAME = "scarline.sensor"
EVENT_COUNT = 3


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def build_payload(
    *,
    blink_detected: bool,
    ear_avg: float | None,
    blink_count: int,
    eyes_closed: bool,
    connected: bool,
) -> dict:
    return {
        "studyId": STUDY_ID,
        "runId": RUN_ID,
        "blinkDetected": blink_detected,
        "eyeAspectRatio": ear_avg,
        "blinkCount": blink_count,
        "eyesClosed": eyes_closed,
        "connected": connected,
        "timestamp": iso_timestamp(),
    }


def build_envelope(payload: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "timestamp": payload["timestamp"],
        "routingKey": ROUTING_KEY,
        "producer": "io-client-demo",
        "type": "event",
        "payload": payload,
        "metadata": {
            "studyId": STUDY_ID,
            "runId": RUN_ID,
            "correlationId": None,
        },
    }


# ── Stub data for --dry-run ─────────────────────────────────────────────────
STUB_READINGS = [
    {"blinkDetected": False, "eyeAspectRatio": 0.31, "blinkCount": 0, "eyesClosed": False, "connected": True},
    {"blinkDetected": False, "eyeAspectRatio": 0.30, "blinkCount": 0, "eyesClosed": False, "connected": True},
    {"blinkDetected": True,  "eyeAspectRatio": 0.18, "blinkCount": 1, "eyesClosed": True,  "connected": True},
]


async def run_dry() -> None:
    """Stub mode — prints 3 synthetic events without webcam or RabbitMQ."""
    print("[DEMO] Stub mode -- no webcam, no RabbitMQ")
    for i, stub in enumerate(STUB_READINGS, 1):
        payload = build_payload(
            blink_detected=stub["blinkDetected"],
            ear_avg=stub["eyeAspectRatio"],
            blink_count=stub["blinkCount"],
            eyes_closed=stub["eyesClosed"],
            connected=stub["connected"],
        )
        print(f"[DEMO] Event {i}: {json.dumps(payload)}")
    print("[DEMO] Done -- 3 events published")


async def run_live() -> None:
    """Live mode — webcam capture + RabbitMQ publish."""
    import aio_pika  # imported here so --dry-run works without RabbitMQ deps running

    amqp_url = os.environ.get("AMQP_URL", "amqp://guest:guest@localhost:5672/")

    driver = BlinkDetectionDriver()
    driver.initialize({"sample_rate": 10, "camera_index": 0})
    driver.start()

    connection = await aio_pika.connect_robust(amqp_url)
    channel = await connection.channel()
    exchange = await channel.declare_exchange(
        EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True,
    )

    published = 0
    while published < EVENT_COUNT:
        reading = driver.read()
        if reading is not None:
            published += 1
            payload = build_payload(
                blink_detected=reading.data.get("blink_detected", False),
                ear_avg=reading.data.get("ear_avg"),
                blink_count=reading.data.get("blink_count", 0),
                eyes_closed=reading.data.get("eyes_closed", False),
                connected=reading.data.get("connected", False),
            )
            envelope = build_envelope(payload)
            await exchange.publish(
                aio_pika.Message(
                    body=json.dumps(envelope).encode("utf8"),
                    content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                    message_id=envelope["id"],
                ),
                routing_key=ROUTING_KEY,
            )
            print(f"[DEMO] Event {published}: {json.dumps(payload)}")
        await asyncio.sleep(0.1)

    driver.stop()
    driver.shutdown()
    await connection.close()
    print("[DEMO] Done -- 3 events published")


async def main() -> None:
    parser = argparse.ArgumentParser(description="SCARline blink detection demo")
    parser.add_argument("--dry-run", action="store_true", help="Stub mode without webcam or RabbitMQ")
    args = parser.parse_args()

    if args.dry_run:
        await run_dry()
    else:
        await run_live()


if __name__ == "__main__":
    asyncio.run(main())

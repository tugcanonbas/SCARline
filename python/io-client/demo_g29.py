"""Standalone Logitech G29 demo -- publishes 3 events then exits.

Usage:
    python demo_g29.py --dry-run   # stub mode, no hardware, no RabbitMQ
    python demo_g29.py             # real G29 + RabbitMQ
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
import webbrowser

# Ensure scarline_io package is importable when running from python/io-client/
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from scarline_io.drivers.logitech_g29 import LogitechG29Driver


STUDY_ID = "system"
RUN_ID = "global"
ROUTING_KEY = f"events.{STUDY_ID}.{RUN_ID}.driving.io.steering"
EXCHANGE_NAME = "scarline.events"
DEFAULT_DEVICE_PATH = "/dev/input/by-id/usb-Logitech_G29_Driving_Force_Racing_Wheel-event-joystick"


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def build_payload(
    *,
    steering_angle: float,
    throttle: float,
    brake: float,
) -> dict:
    return {
        "studyId": STUDY_ID,
        "runId": RUN_ID,
        "steeringAngle": steering_angle,
        "throttle": throttle,
        "brake": brake,
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
            "studyId": None,
            "runId": None,
            "correlationId": None,
        },
    }


# -- Stub data for --dry-run --------------------------------------------------
STUB_READINGS = [
    {"steeringAngle": 0.0,   "throttle": 0.0, "brake": 0.0},
    {"steeringAngle": 45.5,  "throttle": 0.3, "brake": 0.0},
    {"steeringAngle": -20.0, "throttle": 0.0, "brake": 0.5},
]


async def run_dry() -> None:
    """Stub mode -- publishes synthetic events to RabbitMQ."""
    print("[DEMO G29] Stub mode -- publishing synthetic data")
    import aio_pika
    import math
    
    amqp_url = os.environ.get("AMQP_URL", "amqp://scarline:scarline@localhost:5672/")
    try:
        connection = await aio_pika.connect_robust(amqp_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True)
    except Exception as e:
        print(f"[DEMO G29] Failed to connect to RabbitMQ: {e}")
        return

    dash_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools", "dashboards", "g29.html"))
    webbrowser.open(dash_path)

    t = 0.0
    try:
        while True:
            # Simulate back and forth steering, and some throttle/brake
            steer = math.sin(t * 1.5) * 0.8
            throttle = (math.sin(t * 0.8) + 1.0) / 2.0
            brake = 0.0 if throttle > 0.2 else 0.5
            
            payload = build_payload(
                steering_angle=steer,
                throttle=throttle,
                brake=brake,
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
            t += 0.05
            await asyncio.sleep(0.05)
    except KeyboardInterrupt:
        pass
    finally:
        await connection.close()


async def run_live() -> None:
    """Live mode -- G29 hardware capture + RabbitMQ publish."""
    import aio_pika  # imported here so --dry-run works without RabbitMQ deps running

    amqp_url = os.environ.get("AMQP_URL", "amqp://scarline:scarline@localhost:5672/")

    driver = LogitechG29Driver()
    ok = driver.initialize({"device_path": DEFAULT_DEVICE_PATH, "sample_rate": 100})
    if not ok:
        print("[DEMO G29] ERROR: Failed to initialize G29 driver. Is the wheel connected?", file=sys.stderr)
        sys.exit(1)
    driver.start()

    dash_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools", "dashboards", "g29.html"))
    webbrowser.open(dash_path)

    connection = await aio_pika.connect_robust(amqp_url)
    channel = await connection.channel()
    exchange = await channel.declare_exchange(
        EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True,
    )

    try:
        while True:
            reading = driver.read()
            if reading is not None:
                payload = build_payload(
                    steering_angle=reading.data.get("steer", 0.0),
                    throttle=reading.data.get("throttle", 0.0),
                    brake=reading.data.get("brake", 0.0),
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
            await asyncio.sleep(0.01)
    except KeyboardInterrupt:
        pass
    finally:
        driver.stop()
        driver.shutdown()
        await connection.close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="SCARline G29 steering wheel demo")
    parser.add_argument("--dry-run", action="store_true", help="Stub mode without hardware or RabbitMQ")
    args = parser.parse_args()

    if args.dry_run:
        await run_dry()
    else:
        await run_live()


if __name__ == "__main__":
    asyncio.run(main())

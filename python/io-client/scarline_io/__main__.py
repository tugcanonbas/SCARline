from __future__ import annotations

import asyncio
import hashlib
import json
import os
import pathlib
import time
import uuid
from collections.abc import Callable

import aio_pika
import yaml

from .drivers.base import SensorDriver
from .drivers.logitech_g29 import LogitechG29Driver
from .drivers.usb_camera import UsbCameraDriver

CONFIG_PATH = pathlib.Path(os.environ.get("IO_CLIENT_CONFIG", "/workspace/python/io-client/io-client-config.yaml"))
AMQP_URL = os.environ.get("AMQP_URL", "amqp://scarline:scarline@rabbitmq:5672")

DRIVER_FACTORIES: dict[str, Callable[[], SensorDriver]] = {
    "logitech_g29": LogitechG29Driver,
    "usb_camera": UsbCameraDriver,
}


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf8") as handle:
        return yaml.safe_load(handle)


def routing_key_for_sensor(sensor_type: str, study_id: str, run_id: str) -> str:
    if sensor_type == "steering_wheel":
        return f"events.{study_id}.{run_id}.driving.io.steering"
    if sensor_type == "camera":
        return f"events.{study_id}.{run_id}.sensor.io.camera"
    return f"events.{study_id}.{run_id}.sensor.io.{sensor_type}"


async def publish(exchange: aio_pika.Exchange, routing_key: str, payload: dict, study_id: str | None, run_id: str | None) -> None:
    message = {
        "id": str(uuid.uuid4()),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "routingKey": routing_key,
        "producer": "io-client",
        "type": "event",
        "payload": payload,
        "metadata": {
            "studyId": study_id,
            "runId": run_id,
            "correlationId": None,
        },
    }
    await exchange.publish(
        aio_pika.Message(
            body=json.dumps(message).encode("utf8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=message["id"],
        ),
        routing_key=routing_key,
    )


async def sensor_loop(driver: SensorDriver, exchange: aio_pika.Exchange, study_id: str, run_id: str) -> None:
    metadata = driver.get_metadata()
    delay = 1 / max(metadata.sample_rate, 1)
    while True:
        reading = driver.read()
        if reading:
            await publish(
                exchange,
                routing_key_for_sensor(metadata.sensor_type, study_id, run_id),
                reading.data | {"sensorMetadata": metadata.custom_fields | {"driver": metadata.driver_id}},
                study_id,
                run_id,
            )
        await asyncio.sleep(delay)


async def main() -> None:
    config = load_config()
    connection = await aio_pika.connect_robust(AMQP_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=20)
    commands_exchange = await channel.declare_exchange("scarline.commands", aio_pika.ExchangeType.TOPIC, durable=True)
    events_exchange = await channel.declare_exchange("scarline.events", aio_pika.ExchangeType.TOPIC, durable=True)
    queue = await channel.declare_queue(
        "scarline.io-client.commands",
        durable=True,
        arguments={
            "x-message-ttl": 300000,
            "x-dead-letter-exchange": "scarline.dlx",
        },
    )

    active_tasks: dict[str, asyncio.Task] = {}
    active_drivers: dict[str, SensorDriver] = {}

    async with queue.iterator() as iterator:
        async for message in iterator:
            async with message.process():
                payload = json.loads(message.body.decode("utf8"))
                routing_key = payload["routingKey"]
                data = payload["payload"]

                if routing_key == "commands.io.start-session":
                    study_id = data["studyId"]
                    run_id = data["sessionId"]
                    for sensor_config in data.get("sensors", []):
                        factory = DRIVER_FACTORIES.get(sensor_config.get("driver"))
                        if not factory:
                            continue
                        driver = factory()
                        driver.initialize(sensor_config.get("metadata", {}) | sensor_config)
                        driver.start()
                        task = asyncio.create_task(sensor_loop(driver, events_exchange, study_id, run_id))
                        active_drivers[driver.get_metadata().driver_id] = driver
                        active_tasks[driver.get_metadata().driver_id] = task
                        await publish(
                            events_exchange,
                            "events.system.global.system.sensor.status",
                            {
                                "driverId": driver.get_metadata().driver_id,
                                "sensorType": driver.get_metadata().sensor_type,
                                "connected": driver.is_connected(),
                                "sampleRate": driver.get_metadata().sample_rate,
                                "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                            },
                            None,
                            None,
                        )

                if routing_key == "commands.io.stop-session":
                    for task in active_tasks.values():
                        task.cancel()
                    for driver in active_drivers.values():
                        driver.stop()
                        driver.shutdown()
                    active_tasks.clear()
                    active_drivers.clear()

    await connection.close()


if __name__ == "__main__":
    asyncio.run(main())

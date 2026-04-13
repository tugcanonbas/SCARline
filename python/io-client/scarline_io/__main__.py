from __future__ import annotations

import asyncio
import contextlib
import importlib.metadata
import json
import os
import pathlib
import time
import uuid
from collections.abc import Callable, Iterable

import aio_pika
import yaml

from .drivers.base import SensorDriver
from .drivers.heart_rate import HeartRateDriver
from .drivers.eye_tracker import EyeTrackerDriver
from .drivers.logitech_g29 import LogitechG29Driver
from .drivers.usb_camera import UsbCameraDriver

CONFIG_PATH = pathlib.Path(os.environ.get("IO_CLIENT_CONFIG", "/workspace/python/io-client/io-client-config.yaml"))
AMQP_URL = os.environ.get("AMQP_URL", "amqp://scarline:scarline@rabbitmq:5672")

DRIVER_FACTORIES: dict[str, Callable[[], SensorDriver]] = {
    "logitech_g29": LogitechG29Driver,
    "usb_camera": UsbCameraDriver,
    "heart_rate": HeartRateDriver,
    "eye_tracker": EyeTrackerDriver,
}


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf8") as handle:
        return yaml.safe_load(handle) or {}


def iso_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def discover_driver_factories() -> dict[str, Callable[[], SensorDriver]]:
    factories = DRIVER_FACTORIES.copy()
    try:
        entry_points = importlib.metadata.entry_points(group="scarline_io.drivers")
    except Exception:
        entry_points = []

    for entry_point in entry_points:
        try:
            loaded = entry_point.load()
            if isinstance(loaded, type) and issubclass(loaded, SensorDriver):
                factories[entry_point.name] = loaded
        except Exception as error:
            print(f"io-client failed to load driver plugin {entry_point.name}: {error}", flush=True)

    return factories


def driver_key(sensor_config: dict) -> str:
    return str(sensor_config.get("driver") or sensor_config.get("driverId") or "")


def flatten_sensor_config(sensor_config: dict) -> dict:
    nested_config = sensor_config.get("config", {})
    metadata = sensor_config.get("metadata", {})
    return {
        **(nested_config if isinstance(nested_config, dict) else {}),
        **(metadata if isinstance(metadata, dict) else {}),
        **sensor_config,
        "driver": driver_key(sensor_config),
    }


def enabled_configured_sensors(config: dict) -> list[dict]:
    sensors = config.get("sensors", [])
    if not isinstance(sensors, list):
        return []

    return [
        flatten_sensor_config(sensor)
        for sensor in sensors
        if isinstance(sensor, dict) and sensor.get("enabled", True)
    ]


def merge_with_configured_defaults(session_sensor: dict, configured_sensors: Iterable[dict]) -> dict:
    key = driver_key(session_sensor)
    defaults = next((sensor for sensor in configured_sensors if driver_key(sensor) == key), {})
    return {
        **defaults,
        **flatten_sensor_config(session_sensor),
    }


def routing_key_for_sensor(sensor_type: str, study_id: str, run_id: str) -> str:
    if sensor_type == "steering_wheel":
        return f"events.{study_id}.{run_id}.driving.io.steering"
    if sensor_type == "camera":
        return f"events.{study_id}.{run_id}.sensor.io.camera"
    return f"events.{study_id}.{run_id}.sensor.io.{sensor_type}"


async def publish(exchange: aio_pika.Exchange, routing_key: str, payload: dict, study_id: str | None, run_id: str | None) -> None:
    message = {
        "id": str(uuid.uuid4()),
        "timestamp": iso_timestamp(),
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


async def publish_component_status(events_exchange: aio_pika.Exchange, status: str, message: str) -> None:
    await publish(
        events_exchange,
        "events.system.global.system.component.status",
        {
            "componentId": "io-client",
            "componentName": "I/O Client",
            "status": status,
            "message": message,
            "checkedAt": iso_timestamp(),
        },
        None,
        None,
    )


async def publish_sensor_status(
    events_exchange: aio_pika.Exchange,
    *,
    driver_id: str,
    sensor_type: str,
    connected: bool,
    sample_rate: int,
    message: str | None = None,
    capabilities: list[str] | None = None,
    config_schema: dict | None = None,
    degraded: bool = False,
) -> None:
    await publish(
        events_exchange,
        "events.system.global.system.sensor.status",
        {
            "driverId": driver_id,
            "sensorType": sensor_type,
            "connected": connected,
            "sampleRate": sample_rate,
            "message": message,
            "checkedAt": iso_timestamp(),
            "capabilities": capabilities or [],
            "configSchema": config_schema or {},
            "degraded": degraded,
        },
        None,
        None,
    )


async def publish_driver_status_event(
    events_exchange: aio_pika.Exchange,
    *,
    driver: SensorDriver,
    study_id: str,
    run_id: str,
    message: str | None = None,
) -> None:
    metadata = driver.get_metadata()
    await publish(
        events_exchange,
        f"events.{study_id}.{run_id}.sensor.io.driver_status",
        {
            "driverId": metadata.driver_id,
            "sensorType": metadata.sensor_type,
            "displayName": metadata.display_name,
            "connected": driver.is_connected(),
            "sampleRate": metadata.sample_rate,
            "message": message,
            "checkedAt": iso_timestamp(),
            "capabilities": list(metadata.custom_fields.get("capabilities", [])),
            "configSchema": driver.get_configurable_fields(),
            "degraded": not driver.is_connected(),
        },
        study_id,
        run_id,
    )


async def sensor_loop(driver: SensorDriver, exchange: aio_pika.Exchange, study_id: str, run_id: str) -> None:
    metadata = driver.get_metadata()
    delay = 1 / max(metadata.sample_rate, 1)
    last_status_at = 0.0
    while True:
        try:
            reading = driver.read()
        except Exception as error:
            await publish_sensor_status(
                exchange,
                driver_id=metadata.driver_id,
                sensor_type=metadata.sensor_type,
                connected=False,
                sample_rate=metadata.sample_rate,
                message=f"read failed: {error}",
            )
            await asyncio.sleep(delay)
            continue

        if reading:
            await publish(
                exchange,
                routing_key_for_sensor(metadata.sensor_type, study_id, run_id),
                reading.data | {
                    "sensorMetadata": metadata.custom_fields | {
                        "driver": metadata.driver_id,
                        "connected": driver.is_connected(),
                    }
                },
                study_id,
                run_id,
            )
        if time.monotonic() - last_status_at > 10:
            last_status_at = time.monotonic()
            await publish_sensor_status(
                exchange,
                driver_id=metadata.driver_id,
                sensor_type=metadata.sensor_type,
                connected=driver.is_connected(),
                sample_rate=metadata.sample_rate,
                capabilities=list(metadata.custom_fields.get("capabilities", [])),
                config_schema=driver.get_configurable_fields(),
                degraded=not driver.is_connected(),
            )
            await publish_driver_status_event(exchange, driver=driver, study_id=study_id, run_id=run_id)
        await asyncio.sleep(delay)


async def main() -> None:
    config = load_config()
    configured_sensors = enabled_configured_sensors(config)
    driver_factories = discover_driver_factories()
    connection = await aio_pika.connect_robust(AMQP_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=20)
    commands_exchange = await channel.declare_exchange("scarline.commands", aio_pika.ExchangeType.TOPIC, durable=True)
    events_exchange = await channel.declare_exchange("scarline.events", aio_pika.ExchangeType.TOPIC, durable=True)
    await channel.declare_exchange("scarline.dlx", aio_pika.ExchangeType.FANOUT, durable=True)
    queue = await channel.declare_queue(
        "scarline.io-client.commands",
        durable=True,
        arguments={
            "x-message-ttl": 300000,
            "x-dead-letter-exchange": "scarline.dlx",
        },
    )
    await queue.bind(commands_exchange, "commands.io.*")
    await publish_component_status(events_exchange, "running", "I/O Client connected to RabbitMQ and awaiting session commands")

    active_tasks: dict[str, asyncio.Task] = {}
    active_drivers: dict[str, SensorDriver] = {}

    async with queue.iterator() as iterator:
        async for message in iterator:
            async with message.process(requeue=False):
                payload = json.loads(message.body.decode("utf8"))
                routing_key = payload["routingKey"]
                data = payload["payload"]

                if routing_key == "commands.io.start-session":
                    study_id = data["studyId"]
                    run_id = data["sessionId"]
                    session_sensors = data.get("sensors") or configured_sensors
                    for sensor_config in session_sensors:
                        if not isinstance(sensor_config, dict):
                            continue

                        effective_config = merge_with_configured_defaults(sensor_config, configured_sensors)
                        key = driver_key(effective_config)
                        factory = driver_factories.get(key)
                        if not factory:
                            await publish_sensor_status(
                                events_exchange,
                                driver_id=key or "unknown",
                                sensor_type=str(effective_config.get("sensorType") or effective_config.get("type") or "unknown"),
                                connected=False,
                                sample_rate=0,
                                message="No registered driver factory",
                                degraded=True,
                            )
                            continue
                        driver = factory()
                        task_key = f"{run_id}:{driver.get_metadata().driver_id}"
                        if task_key in active_tasks:
                            existing_task = active_tasks.pop(task_key)
                            existing_task.cancel()
                            with contextlib.suppress(asyncio.CancelledError):
                                await existing_task
                            existing_driver = active_drivers.pop(task_key)
                            existing_driver.stop()
                            existing_driver.shutdown()

                        initialized = driver.initialize(effective_config)
                        driver.start()
                        task = asyncio.create_task(sensor_loop(driver, events_exchange, study_id, run_id))
                        active_drivers[task_key] = driver
                        active_tasks[task_key] = task
                        await publish_sensor_status(
                            events_exchange,
                            driver_id=driver.get_metadata().driver_id,
                            sensor_type=driver.get_metadata().sensor_type,
                            connected=initialized and driver.is_connected(),
                            sample_rate=driver.get_metadata().sample_rate,
                            message=None if initialized else "Driver initialized in degraded mode",
                            capabilities=list(driver.get_metadata().custom_fields.get("capabilities", [])),
                            config_schema=driver.get_configurable_fields(),
                            degraded=not initialized or not driver.is_connected(),
                        )
                        await publish_driver_status_event(
                            events_exchange,
                            driver=driver,
                            study_id=study_id,
                            run_id=run_id,
                            message=None if initialized else "Driver initialized in degraded mode",
                        )

                if routing_key == "commands.io.stop-session":
                    run_id = data.get("sessionId")
                    task_keys = [
                        key for key in active_tasks
                        if not run_id or key.startswith(f"{run_id}:")
                    ]
                    for key in task_keys:
                        task = active_tasks.pop(key)
                        task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await task
                        driver = active_drivers.pop(key)
                        metadata = driver.get_metadata()
                        driver.stop()
                        driver.shutdown()
                        await publish_sensor_status(
                            events_exchange,
                            driver_id=metadata.driver_id,
                            sensor_type=metadata.sensor_type,
                            connected=False,
                            sample_rate=metadata.sample_rate,
                            message="Session stopped",
                            capabilities=list(metadata.custom_fields.get("capabilities", [])),
                            config_schema=driver.get_configurable_fields(),
                            degraded=True,
                        )

    await connection.close()


if __name__ == "__main__":
    asyncio.run(main())

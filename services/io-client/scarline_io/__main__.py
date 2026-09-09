from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

import yaml

from .host import IoHost, install_signal_handlers


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="scarline-io-client")
    result.add_argument("--config"); result.add_argument("--repository-root", default=".")
    result.add_argument("--rabbit-host"); result.add_argument("--rabbit-port", type=int); result.add_argument("--rabbit-user")
    result.add_argument("--drivers-directory"); result.add_argument("--command-journal"); result.add_argument("--media-directory")
    result.add_argument("--health-port", type=int); result.add_argument("--heartbeat-interval", type=int)
    result.add_argument("--batch-max-samples", type=int); result.add_argument("--batch-max-milliseconds", type=int)
    result.add_argument("--mock-enabled", action=argparse.BooleanOptionalAction, default=None)
    return result


def options() -> argparse.Namespace:
    result = parser().parse_args()
    values: dict = {}
    root = Path(result.repository_root).resolve()
    if result.config:
        values = yaml.safe_load(Path(result.config).read_text(encoding="utf8"))
    rabbit = values.get("rabbitmq", {}); api = values.get("api", {}); service = values.get("services", {}).get("io_client", {})
    defaults = {
        "rabbit_host": rabbit.get("host", "127.0.0.1"), "rabbit_port": rabbit.get("port", 5672), "rabbit_user": rabbit.get("user", "scarline"),
        "drivers_directory": root / api.get("sensors_directory", "services/io-client/drivers"),
        "command_journal": root / service.get("command_journal", ".runtime/io-client/command-journal.json"),
        "media_directory": root / service.get("media_directory", ".runtime/io-client/media"),
        "health_port": service.get("health_port", 8081), "heartbeat_interval": service.get("heartbeat_interval_seconds", 5),
        "batch_max_samples": service.get("batch_max_samples", 100), "batch_max_milliseconds": service.get("batch_max_milliseconds", 100),
        "mock_enabled": service.get("mock_enabled", True),
    }
    for key, value in defaults.items():
        if getattr(result, key) is None: setattr(result, key, str(value) if isinstance(value, Path) else value)
    return result


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    host = IoHost(options()); install_signal_handlers(host); await host.run()


def entrypoint() -> None: asyncio.run(main())


if __name__ == "__main__": entrypoint()

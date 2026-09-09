from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from pathlib import Path

from .client import CarlaAdapter
from .config import load_settings


def options() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="scarline-carla-client")
    parser.add_argument("--config", default="/app/config.yml")
    parser.add_argument("--repository-root", default="/app")
    return parser.parse_args()


async def health_server(adapter: CarlaAdapter) -> asyncio.AbstractServer:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(4096)
        ready = adapter.runtime.connected and adapter.registered
        body = json.dumps({
            "service":"carla-client", "status":"ready" if ready else "degraded",
            "carlaConnected":adapter.runtime.connected, "bridgeRegistered":adapter.registered,
            "activeSessionId":adapter.active_configuration["sessionId"] if adapter.active_configuration else None,
        }).encode()
        status = b"200 OK" if ready else b"503 Service Unavailable"
        writer.write(b"HTTP/1.1 " + status + b"\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        await writer.drain(); writer.close(); await writer.wait_closed()
    return await asyncio.start_server(handle, "0.0.0.0", adapter.settings.health_port)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    arguments = options()
    settings = load_settings(Path(arguments.config), Path(arguments.repository_root).resolve())
    adapter = CarlaAdapter(settings)
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        try: loop.add_signal_handler(name, lambda: asyncio.create_task(adapter.stop()))
        except NotImplementedError: pass
    server = await health_server(adapter)
    try: await adapter.run()
    finally:
        server.close(); await server.wait_closed(); await adapter.stop()


def entrypoint() -> None:
    asyncio.run(main())


if __name__ == "__main__": entrypoint()

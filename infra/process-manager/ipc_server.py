from __future__ import annotations

import json
import os
import signal
import socketserver
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path


class UnixHTTPServer(socketserver.UnixStreamServer):
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = "SCARlinePM/0.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _json(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _pid_status(self, name: str) -> str:
        pid_file = Path(self.server.runtime_dir) / "pids" / f"{name}.pid"  # type: ignore[attr-defined]
        if not pid_file.exists():
            return "stopped"
        try:
            pid = int(pid_file.read_text("utf8").strip())
            os.kill(pid, 0)
            return "running"
        except Exception:
            return "error"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/status":
            self._json(
                200,
                {
                    "processManager": "running",
                    "carlaServer": self._pid_status("carla"),
                    "overlayDesktop": self._pid_status("overlay"),
                    "docker": "unknown",
                    "checkedAt": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        if self.path == "/carla/status":
            self._json(200, {"status": self._pid_status("carla")})
            return

        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/overlay/reload"):
            self._json(200, {"acknowledged": True})
            return

        if self.path == "/restart":
            self._json(202, {"accepted": False, "message": "Restart must be requested through the scarline launcher"})
            return

        if self.path.startswith("/carla/") and self.path.endswith(("start", "stop", "restart")):
            self._json(202, {"accepted": True, "path": self.path})
            return

        self._json(404, {"error": "not_found"})


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: ipc_server.py <socket_path> <runtime_dir>")

    socket_path = Path(sys.argv[1])
    runtime_dir = Path(sys.argv[2])
    socket_path.unlink(missing_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    server = UnixHTTPServer(str(socket_path), Handler)
    server.runtime_dir = str(runtime_dir)  # type: ignore[attr-defined]

    def shutdown(_signum: int, _frame) -> None:
        server.shutdown()
        socket_path.unlink(missing_ok=True)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server.serve_forever()


if __name__ == "__main__":
    main()

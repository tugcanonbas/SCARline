from __future__ import annotations

import json
import os
import signal
import socketserver
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse


if hasattr(socketserver, "UnixStreamServer"):
    class UnixHTTPServer(socketserver.UnixStreamServer):  # type: ignore[attr-defined]
        allow_reuse_address = True
else:
    UnixHTTPServer = None  # type: ignore[assignment]


class TcpHTTPServer(HTTPServer):
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

    def _pid_value(self, name: str) -> int | None:
        pid_file = Path(self.server.runtime_dir) / "pids" / f"{name}.pid"  # type: ignore[attr-defined]
        if not pid_file.exists():
            return None
        try:
            return int(pid_file.read_text("utf8").strip())
        except Exception:
            return None

    def _write_pid(self, name: str, pid: int) -> None:
        pid_dir = Path(self.server.runtime_dir) / "pids"  # type: ignore[attr-defined]
        pid_dir.mkdir(parents=True, exist_ok=True)
        (pid_dir / f"{name}.pid").write_text(str(pid), "utf8")

    def _clear_pid(self, name: str) -> None:
        (Path(self.server.runtime_dir) / "pids" / f"{name}.pid").unlink(missing_ok=True)  # type: ignore[attr-defined]

    def _overlay_health(self) -> str:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as response:
                return "running" if response.status == 200 else "error"
        except Exception:
            return self._pid_status("overlay")

    def _reload_overlay(self) -> tuple[bool, str]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        request = urllib.request.Request(f"http://127.0.0.1:{port}/reload", method="POST")
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status in (200, 202), "electron overlay reload requested"
        except urllib.error.URLError as error:
            return False, f"overlay control endpoint unavailable: {error.reason}"
        except Exception as error:
            return False, str(error)

    def _overlay_displays(self) -> tuple[int, dict]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/displays", timeout=2) as response:
                payload = json.loads(response.read().decode("utf8") or "{}")
                return response.status, payload if isinstance(payload, dict) else {"displays": []}
        except urllib.error.URLError as error:
            return 503, {"error": "overlay_control_unavailable", "message": str(error.reason)}
        except Exception as error:
            return 503, {"error": "overlay_control_unavailable", "message": str(error)}

    def _configure_overlay(self, payload: dict) -> tuple[bool, str]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        encoded = json.dumps(payload).encode("utf8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/configure",
            method="POST",
            data=encoded,
            headers={
                "content-type": "application/json",
                "content-length": str(len(encoded)),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status in (200, 202), "electron overlay configured"
        except urllib.error.URLError as error:
            return False, f"overlay control endpoint unavailable: {error.reason}"
        except Exception as error:
            return False, str(error)

    def _close_overlay_windows(self, payload: dict) -> tuple[bool, str]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        encoded = json.dumps(payload).encode("utf8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/windows/close",
            method="POST",
            data=encoded,
            headers={
                "content-type": "application/json",
                "content-length": str(len(encoded)),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status in (200, 202), "electron overlay windows closed"
        except urllib.error.URLError as error:
            return False, f"overlay control endpoint unavailable: {error.reason}"
        except Exception as error:
            return False, str(error)

    def _update_overlay_windows(self, payload: dict) -> tuple[bool, str]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        encoded = json.dumps(payload).encode("utf8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/windows/update",
            method="POST",
            data=encoded,
            headers={
                "content-type": "application/json",
                "content-length": str(len(encoded)),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status in (200, 202), "electron overlay windows updated"
        except urllib.error.URLError as error:
            return False, f"overlay control endpoint unavailable: {error.reason}"
        except Exception as error:
            return False, str(error)

    def _open_overlay_windows(self, payload: dict) -> tuple[bool, str]:
        port = int(os.environ.get("OVERLAY_CONTROL_PORT", "4097"))
        encoded = json.dumps(payload).encode("utf8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/windows/open",
            method="POST",
            data=encoded,
            headers={
                "content-type": "application/json",
                "content-length": str(len(encoded)),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status in (200, 202), "electron overlay windows opened"
        except urllib.error.URLError as error:
            return False, f"overlay control endpoint unavailable: {error.reason}"
        except Exception as error:
            return False, str(error)

    def _docker_status(self) -> str:
        try:
            result = subprocess.run(  # noqa: S603
                ["docker", "info", "--format", "{{.ServerVersion}}"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=2,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                return "running"
            return "degraded"
        except Exception:
            return "degraded"

    def _component_snapshot(self, component: str, status: str, message: str | None = None) -> dict:
        return {
            "component": component,
            "status": status,
            "message": message,
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        }

    def _start_carla(self) -> tuple[bool, str]:
        if self._pid_status("carla") == "running":
            return True, "CARLA server is already running"

        executable = os.environ.get("CARLA_SERVER_PATH", "")
        if not executable:
            return False, "CARLA_SERVER_PATH is not configured"
        if not Path(executable).exists():
            return False, f"Configured CARLA path does not exist: {executable}"

        log_dir = Path(self.server.runtime_dir) / "logs"  # type: ignore[attr-defined]
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = (log_dir / "carla.log").open("ab")
        port = os.environ.get("CARLA_SERVER_PORT", "2000")
        quality = os.environ.get("SCARLINE_CARLA_QUALITY", "Epic")
        import subprocess

        process = subprocess.Popen(
            [executable, f"-carla-rpc-port={port}", f"-quality-level={quality}"],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self._write_pid("carla", process.pid)
        return True, f"CARLA server started with pid {process.pid}"

    def _stop_carla(self) -> tuple[bool, str]:
        pid = self._pid_value("carla")
        if pid is None:
            return True, "CARLA server is already stopped"
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(2)
            try:
                os.kill(pid, 0)
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self._clear_pid("carla")
            return True, "CARLA server stopped"
        except ProcessLookupError:
            self._clear_pid("carla")
            return True, "CARLA server was not running"
        except Exception as error:
            return False, str(error)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/status":
            carla_status = self._pid_status("carla")
            overlay_status = self._overlay_health()
            supervisor_status = self._pid_status("supervisor")
            docker_status = self._docker_status()
            self._json(
                200,
                {
                    "processManager": "running",
                    "carlaServer": carla_status,
                    "overlayDesktop": overlay_status,
                    "supervisor": supervisor_status,
                    "docker": docker_status,
                    "components": {
                        "docker": self._component_snapshot(
                            "docker",
                            docker_status,
                            None if docker_status == "running" else "Docker daemon is not reachable"
                        ),
                        "carlaServer": self._component_snapshot(
                            "carla-server",
                            "running" if carla_status == "running" else "degraded",
                            None if carla_status == "running" else "CARLA process is not running"
                        ),
                        "overlayDesktop": self._component_snapshot(
                            "overlay-desktop",
                            "running" if overlay_status == "running" else "degraded",
                            None if overlay_status == "running" else "Overlay desktop health endpoint is unavailable"
                        ),
                        "supervisor": self._component_snapshot(
                            "supervisor",
                            "running" if supervisor_status == "running" else "degraded",
                            None if supervisor_status == "running" else "Supervisor process is not running"
                        ),
                    },
                    "checkedAt": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        if self.path == "/carla/status":
            self._json(200, {"status": self._pid_status("carla")})
            return

        if self.path == "/overlay/displays":
            status, payload = self._overlay_displays()
            self._json(status, payload)
            return

        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/overlay/reload"):
            accepted, message = self._reload_overlay()
            self._json(202 if accepted else 503, {"accepted": accepted, "message": message})
            return

        if self.path.startswith("/overlay/configure"):
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_payload = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(raw_payload.decode("utf8")) if raw_payload else {}
            except Exception:
                self._json(400, {"accepted": False, "message": "Invalid JSON payload"})
                return
            accepted, message = self._configure_overlay(payload if isinstance(payload, dict) else {})
            self._json(202 if accepted else 503, {"accepted": accepted, "message": message})
            return

        if self.path.startswith("/overlay/windows/update"):
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_payload = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(raw_payload.decode("utf8")) if raw_payload else {}
            except Exception:
                self._json(400, {"accepted": False, "message": "Invalid JSON payload"})
                return
            accepted, message = self._update_overlay_windows(payload if isinstance(payload, dict) else {})
            self._json(202 if accepted else 503, {"accepted": accepted, "message": message})
            return

        if self.path.startswith("/overlay/windows/open"):
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_payload = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(raw_payload.decode("utf8")) if raw_payload else {}
            except Exception:
                self._json(400, {"accepted": False, "message": "Invalid JSON payload"})
                return
            accepted, message = self._open_overlay_windows(payload if isinstance(payload, dict) else {})
            self._json(202 if accepted else 503, {"accepted": accepted, "message": message})
            return

        if self.path.startswith("/overlay/windows/close"):
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_payload = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(raw_payload.decode("utf8")) if raw_payload else {}
            except Exception:
                self._json(400, {"accepted": False, "message": "Invalid JSON payload"})
                return
            accepted, message = self._close_overlay_windows(payload if isinstance(payload, dict) else {})
            self._json(202 if accepted else 503, {"accepted": accepted, "message": message})
            return

        if self.path == "/restart":
            self._json(202, {"accepted": False, "message": "Restart must be requested through the scarline launcher"})
            return

        if self.path == "/carla/start":
            accepted, message = self._start_carla()
            self._json(202 if accepted else 409, {"accepted": accepted, "message": message})
            return

        if self.path == "/carla/stop":
            accepted, message = self._stop_carla()
            self._json(202 if accepted else 409, {"accepted": accepted, "message": message})
            return

        if self.path == "/carla/restart":
            stopped, stop_message = self._stop_carla()
            if not stopped:
                self._json(409, {"accepted": False, "message": stop_message})
                return
            accepted, message = self._start_carla()
            self._json(202 if accepted else 409, {"accepted": accepted, "message": message})
            return

        self._json(404, {"error": "not_found"})


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: ipc_server.py <socket_path> <runtime_dir>")

    socket_arg = sys.argv[1]
    runtime_dir = Path(sys.argv[2])
    runtime_dir.mkdir(parents=True, exist_ok=True)

    socket_path: Path | None = None
    if socket_arg.startswith("tcp://"):
        parsed = urlparse(socket_arg)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 4098
        server = TcpHTTPServer((host, port), Handler)
    else:
        if UnixHTTPServer is None:
            raise SystemExit("Unix sockets are unavailable on this platform; use tcp://host:port")
        socket_path = Path(socket_arg)
        socket_path.unlink(missing_ok=True)
        server = UnixHTTPServer(str(socket_path), Handler)

    server.runtime_dir = str(runtime_dir)  # type: ignore[attr-defined]

    def shutdown(_signum: int, _frame) -> None:
        server.shutdown()
        if socket_path is not None:
            socket_path.unlink(missing_ok=True)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server.serve_forever()


if __name__ == "__main__":
    main()

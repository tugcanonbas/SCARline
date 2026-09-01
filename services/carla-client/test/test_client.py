from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from scarline_carla.client import CarlaAdapter
from scarline_carla.config import Settings
from test_models import configuration


class FakeRuntime:
    connected = True
    paused = False

    def __init__(self) -> None:
        self.active_configuration = None
        self.controls: list[dict] = []

    def bind(self, value: dict) -> None: self.active_configuration = value
    def advance(self, value: dict) -> None: self.active_configuration = value
    def pause(self) -> None: self.paused = True
    def resume(self) -> None: self.paused = False
    def unbind(self): self.active_configuration = None; return None
    def apply_realtime_control(self, value: dict) -> None: self.controls.append(value)
    def close(self) -> None: pass


class CarlaAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.runtime = FakeRuntime()
        self.adapter = CarlaAdapter(Settings(
            repository_root=root, bridge_url="ws://sim-bridge:9000/adapter",
            adapter_secret="s" * 32, adapter_id="carla-primary", priority=10,
            expected_carla_version="0.9.16", carla_host="carla-server", carla_port=2000,
            health_port=8082, reconnect_interval=2, reconnect_grace=10,
            maximum_message_bytes=1_048_576,
            command_journal=root / "journal.json", media_directory=root / "media",
            control_timeout_milliseconds=500,
        ), self.runtime)

    async def asyncTearDown(self) -> None: self.temporary.cleanup()

    async def test_binds_pauses_resumes_and_unbinds_a_session(self) -> None:
        study = "550e8400-e29b-41d4-a716-446655440000"
        session = "550e8400-e29b-41d4-a716-446655440001"
        condition = "550e8400-e29b-41d4-a716-446655440002"
        bind = {
            "type":"adapter.bind_session", "studyId":study, "sessionId":session,
            "sessionConditionId":condition, "sequence":0, "simulatorType":"carla",
            "configuration":configuration(),
        }
        self.assertIn("started", await self.adapter._apply_command(bind))
        self.assertEqual(self.adapter.active_configuration["sessionId"], session)
        await self.adapter._apply_command({"type":"adapter.pause_session","sessionId":session})
        self.assertTrue(self.adapter.paused)
        await self.adapter._apply_command({"type":"adapter.resume_session","sessionId":session})
        self.assertFalse(self.adapter.paused)
        await self.adapter._apply_command({"type":"adapter.unbind_session","sessionId":session})
        self.assertIsNone(self.adapter.active_configuration)


if __name__ == "__main__": unittest.main()

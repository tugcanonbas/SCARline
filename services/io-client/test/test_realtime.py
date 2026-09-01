from __future__ import annotations

import json
import unittest

from scarline_io.host import ActiveDevice, IoHost
from scarline_io.models import Reading


class FakeExchange:
    def __init__(self) -> None: self.messages = []
    async def publish(self, message, routing_key: str) -> None: self.messages.append((message, routing_key))


class RealtimeControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_publishes_nonpersistent_control_without_replacing_the_recorded_batch(self) -> None:
        host = object.__new__(IoHost)
        host.realtime = FakeExchange()
        active = ActiveDevice(
            "550e8400-e29b-41d4-a716-446655440001",
            "550e8400-e29b-41d4-a716-446655440000",
            "550e8400-e29b-41d4-a716-446655440002",
            {"sourceKey":"driver:logitech_g29"},
            None,
        )
        await host._publish_realtime_control(active, Reading(
            "controls", {"steer":-0.2,"throttle":0.4,"brake":0.0,"gear":2},
            "2026-08-25T12:00:00.000Z",
        ), 7)
        self.assertEqual(len(host.realtime.messages), 1)
        message, routing_key = host.realtime.messages[0]
        self.assertEqual(routing_key, f"controls.{active.session_id}")
        self.assertEqual(message.delivery_mode.value, 1)
        self.assertEqual(json.loads(message.body)["sequence"], 7)


if __name__ == "__main__": unittest.main()

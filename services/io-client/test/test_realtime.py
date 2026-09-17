from __future__ import annotations

import json
import unittest

from scarline_io.host import ActiveDevice, IoHost
from scarline_io.models import Reading


class FakeExchange:
    def __init__(self) -> None: self.messages = []
    async def publish(self, message, routing_key: str) -> None: self.messages.append((message, routing_key))


class RealtimeControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_channels_publish_the_first_sample_without_waiting_for_another(self) -> None:
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch
        class Driver:
            connected = running = True
            async def read(self, channel):
                self.connected = False
                return Reading(channel, {"heartRateBpm": 72})
        host = object.__new__(IoHost)
        host.options = SimpleNamespace(batch_max_samples=100, batch_max_milliseconds=100)
        host.instance_id = "test-host"
        host.publish = AsyncMock()
        active = ActiveDevice("session", "study", "condition", {"sourceKey":"monitor", "deviceId":"device"}, Driver())
        with patch("scarline_io.host.asyncio.sleep", new_callable=AsyncMock):
            await host._samples(active, {"key":"heart_rate", "sensorId":"sensor", "sampleRate":1})
        self.assertEqual(host.publish.await_count, 1)
        self.assertEqual(host.publish.call_args.args[0]["payload"]["samples"], [{"heartRateBpm": 72}])

    async def test_batches_preserve_each_reading_timestamp(self) -> None:
        from types import SimpleNamespace
        times = ["2026-09-13T10:00:00.000Z", "2026-09-13T10:00:00.173Z"]
        class Driver:
            connected = running = True
            count = 0
            async def read(self, channel):
                reading = Reading(channel, {"heartRateBpm": 72 + self.count}, times[self.count])
                self.count += 1
                if self.count == 2: self.connected = False
                return reading
        host = object.__new__(IoHost)
        host.options = SimpleNamespace(batch_max_samples=2, batch_max_milliseconds=10_000)
        host.instance_id = "test-host"
        messages = []
        async def publish(message): messages.append(message)
        host.publish = publish
        active = ActiveDevice("session", "study", "condition", {"sourceKey":"monitor", "deviceId":"device"}, Driver())
        await host._samples(active, {"key":"heart_rate", "sensorId":"sensor", "sampleRate":1000})
        self.assertEqual(messages[0]["payload"]["sampleTimestamps"], times)
        self.assertEqual([sample["heartRateBpm"] for sample in messages[0]["payload"]["samples"]], [72, 73])

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

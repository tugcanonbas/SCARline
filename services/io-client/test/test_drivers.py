from __future__ import annotations

import unittest
import math
from types import SimpleNamespace
from unittest.mock import patch

from scarline_io.drivers.builtin import G29Driver, HeartRateDriver, MockDriver


class MockDriverTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_health_test_signals_vary_and_are_explicitly_simulated(self) -> None:
        clock = SimpleNamespace(monotonic=lambda: 0.0)
        with patch("scarline_io.drivers.builtin.time", clock):
            driver = MockDriver(); await driver.connect(); await driver.start()
            fields = {"heart_rate": ["heartRateBpm", "rrIntervalMs"], "blood_pressure": ["systolic", "diastolic"],
                      "spo2": ["spo2Percent"], "respiration": ["respirationRateRpm"]}
            observed = {channel: [] for channel in fields}
            for second in (0, 4, 9, 17):
                clock.monotonic = lambda: second
                for channel, names in fields.items():
                    sample = (await driver.read(channel)).sample
                    self.assertTrue(sample["simulated"])
                    self.assertTrue(all(math.isfinite(sample[name]) for name in names))
                    observed[channel].append(tuple(sample[name] for name in names))
                    if channel == "heart_rate": self.assertAlmostEqual(sample["rrIntervalMs"], 60_000 / sample["heartRateBpm"], delta=.1)
                    if channel == "blood_pressure": self.assertGreater(sample["systolic"], sample["diastolic"])
            for channel, samples in observed.items(): self.assertGreater(len(set(samples)), 1, channel)
            self.assertIsNone(await driver.read("unsupported"))

    async def test_ecg_signal_changes_rate_and_amplitude_over_time(self) -> None:
        clock = SimpleNamespace(monotonic=lambda: 0.0)
        with patch("scarline_io.drivers.builtin.time", clock):
            driver = MockDriver(); await driver.connect(); await driver.start()
            segments = []
            for start in (0, 30):
                values = []
                for index in range(2_000):
                    instant = start + index / 250
                    clock.monotonic = lambda: instant
                    reading = await driver.read("ecg")
                    self.assertTrue(reading.sample["simulated"])
                    self.assertEqual(reading.sample["vitals.ecg_status"], "Simulated ECG")
                    values.append(reading.sample["value"])
                peaks = sum(a < b and b > c and b > .5 for a, b, c in zip(values, values[1:], values[2:]))
                segments.append((peaks, round(max(values), 2)))
            self.assertNotEqual(segments[0][0], segments[1][0], "ECG rate should change with the synthetic heart rate")
            self.assertNotEqual(segments[0][1], segments[1][1], "Test amplitude should also change")

    async def test_produces_readings_only_while_running(self) -> None:
        driver = MockDriver()
        await driver.connect()
        self.assertIsNone(await driver.read("steering"))
        await driver.start()
        reading = await driver.read("steering")
        self.assertIsNotNone(reading)
        self.assertTrue(reading.sample["connected"])
        self.assertIn("steer", reading.sample)
        await driver.disconnect()
        self.assertIsNone(await driver.read("steering"))


class G29NormalizationTests(unittest.TestCase):
    def test_defaults_to_the_linux_inverted_pedal_range(self) -> None:
        driver = G29Driver()
        self.assertEqual(driver._pedal(255, 0, 255), 0)
        self.assertEqual(driver._pedal(0, 0, 255), 1)

    def test_centers_steering_and_allows_noninverted_pedals(self) -> None:
        driver = G29Driver(); driver.configuration = {"invertPedals":False,"steeringDeadzone":.02}
        self.assertEqual(driver._steering(32_767.5, 0, 65_535), 0)
        self.assertEqual(driver._pedal(255, 0, 255), 1)


class HeartRateFreshnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_serial_silence_does_not_republish_a_cached_reading(self) -> None:
        from types import SimpleNamespace
        lines = iter([b"BPM:72\n", b"", b"not a sample", b"BPM:nan\n"])
        driver = HeartRateDriver()
        driver.running = driver.connected = True
        driver.serial = SimpleNamespace(readline=lambda: next(lines))
        self.assertEqual((await driver.read("heart_rate")).sample["heartRateBpm"], 72)
        for _ in range(3): self.assertIsNone(await driver.read("heart_rate"))

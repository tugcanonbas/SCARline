from __future__ import annotations

import unittest

from scarline_io.drivers.builtin import G29Driver, MockDriver


class MockDriverTests(unittest.IsolatedAsyncioTestCase):
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

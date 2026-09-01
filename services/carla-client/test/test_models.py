from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from scarline_carla.models import safe_relative_directory, validate_carla_configuration


def configuration() -> dict:
    return {
        "map":"Town03", "weatherPreset":"ClearNoon",
        "weatherCustom":{"cloudiness":0,"precipitation":0,"windIntensity":0},
        "egoVehicleBlueprint":"vehicle.lincoln.mkz_2020",
        "simulationMode":"synchronous", "fixedDeltaSeconds":0.05,
        "controlMode":"io", "randomSeed":42,
        "trafficConfig":{"npcVehicleCount":2,"speedDifference":0,"speedLimitOverride":50},
        "pedestrianConfig":{"pedestrianCount":1},
        "sunConfig":{"sunAltitudeAngle":45},
        "spectatorConfig":{"enabled":True,"x":-6,"y":0,"z":4,"pitch":-15,"yaw":0,"roll":0},
        "recordingConfig":{"enabled":True,"directory":"condition-a"},
        "sensors":[{"type":"sensor.other.gnss","id":"gnss","attributes":{},"transform":{"x":0,"y":0,"z":2.2}}],
    }


class CarlaConfigurationTests(unittest.TestCase):
    def test_accepts_the_committed_configuration_shape(self) -> None:
        self.assertEqual(validate_carla_configuration(configuration())["controlMode"], "io")

    def test_enforces_research_timing(self) -> None:
        value = configuration(); value["fixedDeltaSeconds"] = 0.1
        with self.assertRaisesRegex(ValueError, "synchronous mode"):
            validate_carla_configuration(value)

    def test_rejects_recording_path_escape(self) -> None:
        with self.assertRaisesRegex(ValueError, "stay inside"):
            safe_relative_directory("../outside")

    def test_rejects_duplicate_sensor_ids(self) -> None:
        value = configuration(); value["sensors"].append(dict(value["sensors"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate sensor id"):
            validate_carla_configuration(value)

    def test_rejects_an_invalid_speed_limit_override(self) -> None:
        value = configuration(); value["trafficConfig"]["speedLimitOverride"] = 301
        with self.assertRaisesRegex(ValueError, "speedLimitOverride"):
            validate_carla_configuration(value)


if __name__ == "__main__": unittest.main()

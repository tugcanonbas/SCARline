from __future__ import annotations

import re
import unittest

from scarline_io.models import envelope, timestamp


class ModelTests(unittest.TestCase):
    def test_timestamps_have_millisecond_precision(self) -> None:
        self.assertRegex(timestamp(), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

    def test_envelope_contains_session_and_source_metadata(self) -> None:
        value = envelope("events.study.session.health.io.heart_rate", {"value": 72}, study_id="study", session_id="session", instance_id="instance")
        self.assertTrue(re.fullmatch(r"[0-9a-f-]{36}", value["id"]))
        self.assertEqual(value["metadata"]["sessionId"], "session")
        self.assertEqual(value["metadata"]["source"], {"component": "io-client", "instanceId": "instance"})

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scarline_io.catalogue import load_manifests


class CatalogueTests(unittest.TestCase):
    def test_loads_manifests_by_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "mock.json").write_text(json.dumps({"key": "mock"}), encoding="utf8")
            self.assertEqual(load_manifests(root), {"mock": {"key": "mock"}})

    def test_rejects_duplicate_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("one.json", "two.json"):
                (root / name).write_text(json.dumps({"key": "same"}), encoding="utf8")
            with self.assertRaisesRegex(ValueError, "Duplicate driver key"):
                load_manifests(root)

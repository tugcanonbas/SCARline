from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scarline_io.journal import CommandJournal


class CommandJournalTests(unittest.TestCase):
    def test_persists_acknowledgements_across_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "commands.json"
            first = CommandJournal(path)
            first.finish("command-1", {"status": "completed"})
            second = CommandJournal(path)
            self.assertEqual(second.get("command-1"), {"status": "completed"})
            self.assertIsNone(second.get("missing"))

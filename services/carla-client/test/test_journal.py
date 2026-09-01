from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from scarline_carla.journal import CommandJournal


class CommandJournalTests(unittest.TestCase):
    def test_persists_results_and_active_binding_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            journal = CommandJournal(path)
            configuration = {"sessionId":"550e8400-e29b-41d4-a716-446655440001"}
            result = {"commandId":"550e8400-e29b-41d4-a716-446655440002","success":True}
            journal.record(result["commandId"], result, configuration, True)
            recovered = CommandJournal(path)
            self.assertEqual(recovered.get(result["commandId"]), result)
            self.assertEqual(recovered.active_configuration, configuration)
            self.assertTrue(recovered.paused)


if __name__ == "__main__": unittest.main()

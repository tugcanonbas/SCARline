import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MockCommandJournal } from "../src/journal.js";

test("preserves command results and active session state across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "scarline-mock-journal-"));
  const file = path.join(directory, "commands.json");
  const commandId = "550e8400-e29b-41d4-a716-446655440021";
  const configuration = {
    studyId: "550e8400-e29b-41d4-a716-446655440022",
    sessionId: "550e8400-e29b-41d4-a716-446655440023",
    sessionConditionId: "550e8400-e29b-41d4-a716-446655440024",
    sequence: 0,
    simulatorType: "mock" as const,
    configuration: { seed: 1 },
  };
  const journal = new MockCommandJournal(file);
  await journal.load();
  await journal.record({
    version: 1,
    id: "550e8400-e29b-41d4-a716-446655440025",
    timestamp: "2026-08-24T12:00:00.000Z",
    type: "adapter.command_result",
    commandId,
    success: true,
    code: "COMPLETED",
    message: "Applied",
    details: {},
    activeSessionId: configuration.sessionId,
  }, configuration, false);

  const reloaded = new MockCommandJournal(file);
  await reloaded.load();
  assert.equal(reloaded.result(commandId)?.success, true);
  assert.equal(reloaded.activeConfiguration?.sessionId, configuration.sessionId);

  await reloaded.clearBinding();
  const cleared = new MockCommandJournal(file);
  await cleared.load();
  assert.equal(cleared.activeConfiguration, null);
  assert.equal(cleared.paused, false);
});

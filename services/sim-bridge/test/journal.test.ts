import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MessageEnvelopeSchema } from "@scarline/contracts";

import { CommandJournal, commandDigest } from "../src/journal.js";

const commandId = "550e8400-e29b-41d4-a716-446655440001";
const studyId = "550e8400-e29b-41d4-a716-446655440002";
const sessionId = "550e8400-e29b-41d4-a716-446655440003";

function command(seed: number) {
  return MessageEnvelopeSchema.parse({
    id: "550e8400-e29b-41d4-a716-446655440004",
    timestamp: "2026-08-24T12:00:00.000Z",
    routingKey: "commands.sim-bridge.session-start",
    producer: "core-api",
    payload: {
      commandId,
      action: "start",
      sessionId,
      deadlineAt: "2026-08-24T12:00:30.000Z",
      configuration: {
        studyId,
        sessionId,
        sessionConditionId: "550e8400-e29b-41d4-a716-446655440005",
        sequence: 0,
        simulatorType: "mock",
        configuration: { seed },
      },
    },
    metadata: {
      studyId,
      sessionId,
      correlationId: commandId,
      source: { component: "core-api", instanceId: null },
    },
  });
}

test("persists terminal acknowledgements and rejects changed replays", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "scarline-sim-bridge-journal-"));
  const file = path.join(directory, "commands.json");
  const first = new CommandJournal(file);
  await first.load();
  const envelope = command(1);
  const digest = commandDigest(envelope);
  await first.begin(commandId, digest, envelope.payload.configuration as never);
  await first.finish(commandId, {
    commandId,
    component: "sim-bridge",
    status: "completed",
    error: null,
    warning: null,
  });

  const reloaded = new CommandJournal(file);
  await reloaded.load();
  assert.equal(reloaded.get(commandId, digest)?.acknowledgement?.status, "completed");
  assert.throws(() => reloaded.get(commandId, commandDigest(command(2))), /different content/);
});

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SimBridgeCommandAcknowledgementSchema,
  SimulatorSessionConfigurationSchema,
  type MessageEnvelope,
  type SimBridgeCommandAcknowledgement,
  type SimulatorSessionConfiguration,
} from "@scarline/contracts";
import { z } from "zod";

const CommandRecordSchema = z.object({
  digest: z.string().length(64),
  status: z.enum(["processing", "completed", "failed"]),
  acknowledgement: z.union([SimBridgeCommandAcknowledgementSchema, z.null()]),
  adapterId: z.string().nullable(),
  configuration: z.union([SimulatorSessionConfigurationSchema, z.null()]),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

const JournalSchema = z.object({
  version: z.literal(1),
  commands: z.record(z.string().uuid(), CommandRecordSchema),
  bindings: z.record(z.string(), SimulatorSessionConfigurationSchema),
}).strict();

type JournalState = z.infer<typeof JournalSchema>;
type CommandRecord = z.infer<typeof CommandRecordSchema>;

const EMPTY_JOURNAL: JournalState = { version: 1, commands: {}, bindings: {} };
const MAX_TERMINAL_COMMANDS = 5_000;

export function commandDigest(envelope: MessageEnvelope): string {
  return createHash("sha256")
    .update(JSON.stringify({
      routingKey: envelope.routingKey,
      payload: envelope.payload,
      studyId: envelope.metadata.studyId,
      sessionId: envelope.metadata.sessionId,
    }))
    .digest("hex");
}

export class CommandJournal {
  readonly #filePath: string;
  #state: JournalState = structuredClone(EMPTY_JOURNAL);
  #writeQueue: Promise<void> = Promise.resolve();
  #loaded = false;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  get isLoaded(): boolean {
    return this.#loaded;
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    try {
      this.#state = JournalSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Sim Bridge command journal is invalid or unreadable.", { cause: error });
      }
      this.#state = structuredClone(EMPTY_JOURNAL);
      await this.#persist();
    }
    this.#loaded = true;
  }

  get(commandId: string, digest: string): CommandRecord | undefined {
    const record = this.#state.commands[commandId];
    if (record !== undefined && record.digest !== digest) {
      throw new Error(`Command ${commandId} was replayed with different content.`);
    }
    return record === undefined ? undefined : structuredClone(record);
  }

  async begin(
    commandId: string,
    digest: string,
    configuration: SimulatorSessionConfiguration | null,
  ): Promise<CommandRecord> {
    const existing = this.get(commandId, digest);
    if (existing !== undefined) return existing;
    const record: CommandRecord = {
      digest,
      status: "processing",
      acknowledgement: null,
      adapterId: null,
      configuration,
      updatedAt: new Date().toISOString(),
    };
    this.#state.commands[commandId] = record;
    await this.#persist();
    return structuredClone(record);
  }

  async assignAdapter(commandId: string, adapterId: string): Promise<void> {
    const record = this.#state.commands[commandId];
    if (record === undefined) throw new Error(`Unknown journal command ${commandId}.`);
    record.adapterId = adapterId;
    record.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async finish(commandId: string, acknowledgement: SimBridgeCommandAcknowledgement): Promise<void> {
    const record = this.#state.commands[commandId];
    if (record === undefined) throw new Error(`Unknown journal command ${commandId}.`);
    record.status = acknowledgement.status === "completed" ? "completed" : "failed";
    record.acknowledgement = SimBridgeCommandAcknowledgementSchema.parse(acknowledgement);
    record.updatedAt = new Date().toISOString();
    this.#prune();
    await this.#persist();
  }

  getBinding(adapterId: string): SimulatorSessionConfiguration | undefined {
    const binding = this.#state.bindings[adapterId];
    return binding === undefined ? undefined : structuredClone(binding);
  }

  recoverBinding(adapterId: string): SimulatorSessionConfiguration | undefined {
    const binding = this.getBinding(adapterId);
    if (binding !== undefined) return binding;
    const processing = Object.values(this.#state.commands).find(
      (record) => record.status === "processing" && record.adapterId === adapterId && record.configuration !== null,
    );
    return processing?.configuration === null || processing?.configuration === undefined
      ? undefined
      : structuredClone(processing.configuration);
  }

  async setBinding(adapterId: string, configuration: SimulatorSessionConfiguration): Promise<void> {
    this.#state.bindings[adapterId] = SimulatorSessionConfigurationSchema.parse(configuration);
    await this.#persist();
  }

  async clearBinding(adapterId: string): Promise<void> {
    delete this.#state.bindings[adapterId];
    await this.#persist();
  }

  #prune(): void {
    const terminal = Object.entries(this.#state.commands)
      .filter(([, record]) => record.status !== "processing")
      .sort(([, left], [, right]) => left.updatedAt.localeCompare(right.updatedAt));
    for (const [commandId] of terminal.slice(0, Math.max(0, terminal.length - MAX_TERMINAL_COMMANDS))) {
      delete this.#state.commands[commandId];
    }
  }

  async #persist(): Promise<void> {
    const snapshot = JSON.stringify(this.#state, null, 2) + "\n";
    const temporary = `${this.#filePath}.${process.pid}.tmp`;
    this.#writeQueue = this.#writeQueue.then(async () => {
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#filePath);
    });
    await this.#writeQueue;
  }
}

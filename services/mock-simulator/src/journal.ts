import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AdapterCommandResultMessageSchema,
  SimulatorSessionConfigurationSchema,
  type AdapterCommandResultMessage,
  type SimulatorSessionConfiguration,
} from "@scarline/contracts";
import { z } from "zod";

const StateSchema = z.object({
  version: z.literal(1),
  activeConfiguration: z.union([SimulatorSessionConfigurationSchema, z.null()]),
  paused: z.boolean(),
  results: z.record(z.string().uuid(), AdapterCommandResultMessageSchema),
}).strict();

type State = z.infer<typeof StateSchema>;
const EMPTY: State = { version: 1, activeConfiguration: null, paused: false, results: {} };
const MAX_RESULTS = 5_000;

export class MockCommandJournal {
  readonly #filePath: string;
  #state: State = structuredClone(EMPTY);
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  get activeConfiguration(): SimulatorSessionConfiguration | null {
    return this.#state.activeConfiguration === null
      ? null
      : structuredClone(this.#state.activeConfiguration);
  }

  get paused(): boolean {
    return this.#state.paused;
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
    try {
      this.#state = StateSchema.parse(JSON.parse(await readFile(this.#filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Mock Simulator command journal is invalid or unreadable.", { cause: error });
      }
      this.#state = structuredClone(EMPTY);
      await this.#persist();
    }
  }

  result(commandId: string): AdapterCommandResultMessage | undefined {
    const result = this.#state.results[commandId];
    return result === undefined ? undefined : structuredClone(result);
  }

  async record(
    result: AdapterCommandResultMessage,
    activeConfiguration: SimulatorSessionConfiguration | null,
    paused: boolean,
  ): Promise<void> {
    this.#state.results[result.commandId] = AdapterCommandResultMessageSchema.parse(result);
    this.#state.activeConfiguration = activeConfiguration;
    this.#state.paused = paused;
    const ids = Object.keys(this.#state.results);
    for (const commandId of ids.slice(0, Math.max(0, ids.length - MAX_RESULTS))) {
      delete this.#state.results[commandId];
    }
    await this.#persist();
  }

  async clearBinding(): Promise<void> {
    this.#state.activeConfiguration = null;
    this.#state.paused = false;
    await this.#persist();
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

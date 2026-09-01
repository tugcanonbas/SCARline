import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ComposeServiceStatus,
  InfrastructureContext,
  InfrastructurePhase,
} from "./compose.js";

interface PlatformState {
  readonly version: 1;
  readonly phase: InfrastructurePhase;
  readonly recordedAt: string;
  readonly composeProject: string;
  readonly services: readonly ComposeServiceStatus[];
}

export async function writePlatformState(
  context: InfrastructureContext,
  phase: InfrastructurePhase,
  services: readonly ComposeServiceStatus[],
): Promise<void> {
  const state: PlatformState = {
    version: 1,
    phase,
    recordedAt: new Date().toISOString(),
    composeProject: context.config.docker.project_name,
    services,
  };
  const targetPath = path.join(context.stateDirectory, "platform.json");
  const temporaryPath = path.join(
    context.stateDirectory,
    `.platform-${process.pid}-${randomUUID()}.tmp`,
  );

  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, targetPath);
}

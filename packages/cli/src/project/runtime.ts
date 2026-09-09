import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { LoadedProjectConfig } from "./config.js";

export const RUNTIME_DIRECTORY_NAMES = [
  "logs",
  "processes",
  "state",
  "postgres",
  "rabbitmq",
  "sim-bridge",
  "mock-simulator",
  "carla-client",
  "carla-client/media",
  "io-client",
  "io-client/media",
] as const;

export async function initializeRuntimeDirectories(
  project: LoadedProjectConfig,
): Promise<readonly string[]> {
  const directories = new Set([
    project.runtimeDirectory,
    project.loggingDirectory,
    project.exportsDirectory,
    ...RUNTIME_DIRECTORY_NAMES.map((directory) =>
      path.join(project.runtimeDirectory, directory),
    ),
  ]);

  await Promise.all(
    [...directories].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );

  return [...directories];
}

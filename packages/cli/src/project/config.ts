import { ScarlineConfigSchema, type ScarlineConfig } from "@scarline/contracts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { ProjectError, describeError } from "./errors.js";
import { resolvePathInsideRepository } from "./repository.js";

export interface LoadedProjectConfig {
  readonly config: ScarlineConfig;
  readonly configPath: string;
  readonly runtimeDirectory: string;
  readonly loggingDirectory: string;
  readonly exportsDirectory: string;
  readonly widgetsDirectory: string;
  readonly sensorsDirectory: string;
}

function formatIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => {
      const location = issue.path.length === 0 ? "config" : issue.path.join(".");
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

export async function loadProjectConfig(
  repositoryRoot: string,
): Promise<LoadedProjectConfig> {
  const configPath = path.join(repositoryRoot, "config.yml");
  let input: unknown;

  try {
    input = parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new ProjectError(
      `Unable to read config.yml: ${describeError(error)}`,
      { cause: error },
    );
  }

  const result = ScarlineConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ProjectError(`Invalid config.yml: ${formatIssues(result.error.issues)}`);
  }

  const runtimeDirectory = resolvePathInsideRepository(
    repositoryRoot,
    result.data.platform.runtime_directory,
    "platform.runtime_directory",
  );
  const loggingDirectory = resolvePathInsideRepository(
    repositoryRoot,
    result.data.logging.directory,
    "logging.directory",
  );
  const exportsDirectory = resolvePathInsideRepository(
    repositoryRoot,
    result.data.api.exports_directory,
    "api.exports_directory",
  );
  const widgetsDirectory = resolvePathInsideRepository(
    repositoryRoot,
    result.data.api.widgets_directory,
    "api.widgets_directory",
  );
  const sensorsDirectory = resolvePathInsideRepository(
    repositoryRoot,
    result.data.api.sensors_directory,
    "api.sensors_directory",
  );
  const relativeLoggingPath = path.relative(runtimeDirectory, loggingDirectory);

  if (
    relativeLoggingPath === ".." ||
    relativeLoggingPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeLoggingPath)
  ) {
    throw new ProjectError("logging.directory must resolve inside the runtime directory.");
  }
  const relativeExportsPath = path.relative(runtimeDirectory, exportsDirectory);
  if (
    relativeExportsPath === ".." ||
    relativeExportsPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeExportsPath)
  ) {
    throw new ProjectError(
      "api.exports_directory must resolve inside the runtime directory.",
    );
  }

  return {
    config: result.data,
    configPath,
    runtimeDirectory,
    loggingDirectory,
    exportsDirectory,
    widgetsDirectory,
    sensorsDirectory,
  };
}

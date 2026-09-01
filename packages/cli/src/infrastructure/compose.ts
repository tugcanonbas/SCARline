import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ScarlineConfig } from "@scarline/contracts";

import {
  ProjectError,
  findRepositoryRoot,
  loadEnvironmentSecrets,
  loadProjectConfig,
  resolvePathInsideRepository,
} from "../project/index.js";

export interface ComposeExecution {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ComposeRunner {
  run(
    args: readonly string[],
    options: { readonly cwd: string; readonly timeoutMilliseconds: number },
  ): Promise<ComposeExecution>;
}

export interface InfrastructureContext {
  readonly repositoryRoot: string;
  readonly config: ScarlineConfig;
  readonly envPath: string;
  readonly composePath: string;
  readonly stateDirectory: string;
  readonly secretValues: readonly string[];
}

export interface ComposeServiceStatus {
  readonly service: string;
  readonly name: string;
  readonly state: string;
  readonly health: string;
  readonly exitCode: number;
}

export type InfrastructurePhase =
  | "running"
  | "starting"
  | "stopped"
  | "degraded";

export interface InfrastructureStatus {
  readonly phase: InfrastructurePhase;
  readonly services: readonly ComposeServiceStatus[];
}

export function expectedComposeServices(
  context: InfrastructureContext,
  includeMockSimulator = false,
  includeCarla = false,
): readonly string[] {
  return [
    "database",
    "rabbitmq",
    ...(context.config.services.core_api.enabled ? ["core-api"] : []),
    ...(context.config.services.admin_panel.enabled ? ["admin-panel"] : []),
    ...(context.config.services.sim_bridge.enabled ? ["sim-bridge"] : []),
    ...(context.config.services.overlay_web.enabled ? ["overlay-web"] : []),
    ...(context.config.services.io_client.enabled && context.config.services.io_client.runtime === "docker" ? ["io-client"] : []),
    ...(includeMockSimulator ? ["mock-simulator"] : []),
    ...(includeCarla ? ["carla-client"] : []),
  ];
}

export function missingComposeServices(
  context: InfrastructureContext,
  status: InfrastructureStatus,
  includeMockSimulator = false,
  includeCarla = false,
): readonly string[] {
  const present = new Set(status.services.map(({ service }) => service));
  return expectedComposeServices(context, includeMockSimulator, includeCarla).filter((service) => !present.has(service));
}

const execFileAsync = promisify(execFile);

export const defaultComposeRunner: ComposeRunner = {
  async run(args, options) {
    try {
      const { stdout, stderr } = await execFileAsync("docker", [...args], {
        cwd: options.cwd,
        timeout: options.timeoutMilliseconds,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      const processError = error as Error & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        exitCode:
          typeof processError.code === "number" ? processError.code : 1,
        stdout: processError.stdout ?? "",
        stderr: processError.stderr ?? processError.message,
      };
    }
  },
};

async function requireAccessiblePath(
  targetPath: string,
  label: string,
  mode: number,
): Promise<void> {
  try {
    await access(targetPath, mode);
  } catch {
    throw new ProjectError(`${label} is missing or inaccessible. Run scarline setup.`);
  }
}

export async function loadInfrastructureContext(
  startDirectory: string,
): Promise<InfrastructureContext> {
  const repositoryRoot = await findRepositoryRoot(startDirectory);
  const project = await loadProjectConfig(repositoryRoot);
  const environment = await loadEnvironmentSecrets(repositoryRoot);
  const composePath = resolvePathInsideRepository(
    repositoryRoot,
    project.config.docker.compose_file,
    "docker.compose_file",
  );
  const stateDirectory = path.join(project.runtimeDirectory, "state");

  await requireAccessiblePath(composePath, "Compose file", constants.R_OK);
  await requireAccessiblePath(
    stateDirectory,
    "Runtime state directory",
    constants.R_OK | constants.W_OK,
  );

  return {
    repositoryRoot,
    config: project.config,
    envPath: environment.envPath,
    composePath,
    stateDirectory,
    secretValues: Object.values(environment.secrets),
  };
}

export function composeArguments(
  context: InfrastructureContext,
): readonly string[] {
  return [
    "compose",
    "--project-name",
    context.config.docker.project_name,
    "--env-file",
    context.envPath,
    "--file",
    context.composePath,
  ];
}

function parseService(input: unknown): ComposeServiceStatus {
  if (typeof input !== "object" || input === null) {
    throw new ProjectError("Docker Compose returned an invalid service status.");
  }

  const value = input as Record<string, unknown>;
  if (
    typeof value.Service !== "string" ||
    typeof value.Name !== "string" ||
    typeof value.State !== "string"
  ) {
    throw new ProjectError("Docker Compose returned an incomplete service status.");
  }

  return {
    service: value.Service,
    name: value.Name,
    state: value.State.toLowerCase(),
    health: typeof value.Health === "string" ? value.Health.toLowerCase() : "",
    exitCode: typeof value.ExitCode === "number" ? value.ExitCode : 0,
  };
}

export function parseComposeStatus(output: string): readonly ComposeServiceStatus[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map(parseService).sort((left, right) =>
      left.service.localeCompare(right.service),
    );
  } catch (error) {
    if (error instanceof ProjectError) {
      throw error;
    }

    try {
      return trimmed
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => parseService(JSON.parse(line) as unknown))
        .sort((left, right) => left.service.localeCompare(right.service));
    } catch (lineError) {
      throw new ProjectError("Unable to parse Docker Compose service status.", {
        cause: lineError,
      });
    }
  }
}

export function classifyInfrastructure(
  services: readonly ComposeServiceStatus[],
): InfrastructurePhase {
  if (services.length === 0) {
    return "stopped";
  }

  const allRunning = services.every(({ state }) => state === "running");
  const allHealthy = services.every(
    ({ health }) => health.length === 0 || health === "healthy",
  );
  if (allRunning && allHealthy) {
    return "running";
  }

  const onlyStarting =
    allRunning &&
    services.every(
      ({ health }) =>
        health.length === 0 || health === "healthy" || health === "starting",
    );
  return onlyStarting ? "starting" : "degraded";
}

export async function queryInfrastructureStatus(
  context: InfrastructureContext,
  runner: ComposeRunner,
): Promise<InfrastructureStatus> {
  const result = await runner.run(
    [...composeArguments(context), "ps", "--all", "--format", "json"],
    { cwd: context.repositoryRoot, timeoutMilliseconds: 10_000 },
  );
  if (result.exitCode !== 0) {
    throw new ProjectError(
      formatComposeFailure(result, context.secretValues, "Unable to read service status"),
    );
  }

  const services = parseComposeStatus(result.stdout);
  return {
    phase: classifyInfrastructure(services),
    services,
  };
}

export function formatComposeFailure(
  result: ComposeExecution,
  secretValues: readonly string[],
  fallback: string,
): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  let message = output.split(/\r?\n/, 1)[0]?.trim() || fallback;

  for (const secret of secretValues) {
    if (secret.length > 0) {
      message = message.replaceAll(secret, "[REDACTED]");
    }
  }
  return message;
}

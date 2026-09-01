import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import {
  RUNTIME_DIRECTORY_NAMES,
  describeError,
  loadEnvironmentSecrets,
  loadProjectConfig,
  resolvePathInsideRepository,
} from "../project/index.js";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  readonly status: DoctorCheckStatus;
  readonly name: string;
  readonly detail: string;
}

interface CommandResult {
  readonly ok: boolean;
  readonly output: string;
}

export interface DoctorDependencies {
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  runCommand(command: string, args: readonly string[]): Promise<CommandResult>;
  isPortInUse(port: number): Promise<boolean>;
}

const execFileAsync = promisify(execFile);

async function runCommand(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: 5_000,
      windowsHide: true,
    });
    return {
      ok: true,
      output: `${stdout}${stderr}`.trim(),
    };
  } catch (error) {
    const commandError = error as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: `${commandError.stdout ?? ""}${commandError.stderr ?? ""}`.trim(),
    };
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export const defaultDoctorDependencies: DoctorDependencies = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  runCommand,
  isPortInUse,
};

function check(
  status: DoctorCheckStatus,
  name: string,
  detail: string,
): DoctorCheck {
  return { status, name, detail };
}

function majorVersion(version: string): number | undefined {
  const match = /^(\d+)/.exec(version.trim());
  return match === null ? undefined : Number(match[1]);
}

function pythonVersion(version: string): readonly [number, number] | undefined {
  const match = /Python\s+(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function conciseCommandFailure(result: CommandResult, fallback: string): string {
  if (result.output.length === 0) {
    return fallback;
  }
  return result.output.split(/\r?\n/, 1)[0] ?? fallback;
}

async function collectRuntimeChecks(
  runtimeDirectory: string,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  try {
    const runtimeStat = await stat(runtimeDirectory);
    if (!runtimeStat.isDirectory()) {
      return [
        check("fail", "Runtime", "Configured runtime path is not a directory"),
      ];
    }
    await access(runtimeDirectory, constants.R_OK | constants.W_OK);
    checks.push(
      check("pass", "Runtime", "Runtime directory is readable and writable"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [
        check(
          "fail",
          "Runtime",
          "Runtime directory is missing; run scarline setup",
        ),
      ];
    }
    return [check("fail", "Runtime", describeError(error))];
  }

  const missingDirectories: string[] = [];
  for (const directoryName of RUNTIME_DIRECTORY_NAMES) {
    try {
      const directoryStat = await stat(path.join(runtimeDirectory, directoryName));
      if (!directoryStat.isDirectory()) {
        missingDirectories.push(directoryName);
      }
    } catch {
      missingDirectories.push(directoryName);
    }
  }

  checks.push(
    missingDirectories.length === 0
      ? check("pass", "Runtime layout", "All runtime directories are present")
      : check(
          "fail",
          "Runtime layout",
          `Missing: ${missingDirectories.join(", ")}; run scarline setup`,
        ),
  );
  return checks;
}

async function collectEnvironmentChecks(
  repositoryRoot: string,
  platform: NodeJS.Platform,
): Promise<DoctorCheck[]> {
  try {
    const environment = await loadEnvironmentSecrets(repositoryRoot);
    const checks = [
      check("pass", "Secrets", ".env contains all required secrets"),
    ];

    if (platform !== "win32") {
      const mode = (await stat(environment.envPath)).mode & 0o777;
      checks.push(
        mode & 0o077
          ? check(
              "fail",
              ".env permissions",
              `Expected 600 or stricter, found ${mode.toString(8)}`,
            )
          : check("pass", ".env permissions", "Secret file is owner-only"),
      );
    }
    return checks;
  } catch (error) {
    return [check("fail", "Secrets", describeError(error))];
  }
}

export async function collectDoctorChecks(
  repositoryRoot: string,
  dependencies: DoctorDependencies = defaultDoctorDependencies,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    check("pass", "Repository", repositoryRoot),
  ];

  const nodeMajor = majorVersion(dependencies.nodeVersion);
  checks.push(
    nodeMajor !== undefined && nodeMajor >= 22
      ? check("pass", "Node.js", `v${dependencies.nodeVersion}`)
      : check(
          "fail",
          "Node.js",
          `v22 or newer required; found ${dependencies.nodeVersion}`,
        ),
  );

  const [npmResult, dockerResult, composeResult, daemonResult] =
    await Promise.all([
      dependencies.runCommand("npm", ["--version"]),
      dependencies.runCommand("docker", ["--version"]),
      dependencies.runCommand("docker", ["compose", "version"]),
      dependencies.runCommand("docker", [
        "info",
        "--format",
        "{{.ServerVersion}}",
      ]),
    ]);

  const npmMajor = npmResult.ok ? majorVersion(npmResult.output) : undefined;
  checks.push(
    npmMajor !== undefined && npmMajor >= 10
      ? check("pass", "npm", `v${npmResult.output}`)
      : check(
          "fail",
          "npm",
          npmResult.ok
            ? `v10 or newer required; found ${npmResult.output}`
            : conciseCommandFailure(npmResult, "npm is not available"),
        ),
  );
  checks.push(
    dockerResult.ok
      ? check("pass", "Docker", dockerResult.output)
      : check(
          "fail",
          "Docker",
          conciseCommandFailure(
            dockerResult,
            "Docker is not installed or not on PATH",
          ),
        ),
  );
  checks.push(
    composeResult.ok
      ? check("pass", "Docker Compose", composeResult.output)
      : check(
          "fail",
          "Docker Compose",
          conciseCommandFailure(composeResult, "Docker Compose is unavailable"),
        ),
  );
  const daemonVersion = majorVersion(daemonResult.output);
  checks.push(
    daemonResult.ok && daemonVersion !== undefined
      ? check("pass", "Docker daemon", `Server ${daemonResult.output}`)
      : check(
          "fail",
          "Docker daemon",
          conciseCommandFailure(
            daemonResult,
            "Docker daemon is not reachable",
          ),
        ),
  );

  let project: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    project = await loadProjectConfig(repositoryRoot);
    checks.push(check("pass", "Configuration", "config.yml is valid"));
  } catch (error) {
    checks.push(check("fail", "Configuration", describeError(error)));
    checks.push(
      ...(await collectEnvironmentChecks(repositoryRoot, dependencies.platform)),
    );
    return checks;
  }

  checks.push(
    ...(await collectEnvironmentChecks(repositoryRoot, dependencies.platform)),
  );
  checks.push(...(await collectRuntimeChecks(project.runtimeDirectory)));

  const ioConfig = project.config.services.io_client;
  if (!ioConfig.enabled) {
    checks.push(check("pass", "IO Client", "Disabled in config.yml"));
  } else if (ioConfig.runtime === "docker") {
    checks.push(check("pass", "IO Client", "Configured for Docker Compose"));
  } else {
    const versionResult = await dependencies.runCommand(ioConfig.python_executable, ["--version"]);
    const version = versionResult.ok ? pythonVersion(versionResult.output) : undefined;
    checks.push(version && (version[0] > 3 || version[0] === 3 && version[1] >= 12)
      ? check("pass", "IO Client Python", versionResult.output)
      : check("fail", "IO Client Python", versionResult.ok ? `Python 3.12 or newer required; found ${versionResult.output}` : conciseCommandFailure(versionResult, "Python is unavailable")));
    const venv = path.join(project.runtimeDirectory, "io-client", "venv", dependencies.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    try {
      await access(venv, constants.R_OK | constants.X_OK);
      checks.push(check("pass", "IO Client environment", "Python environment is installed"));
    } catch {
      checks.push(check("fail", "IO Client environment", "Python environment is missing; run scarline setup"));
    }
  }

  if (ioConfig.enabled) {
    try {
      await access(project.sensorsDirectory, constants.R_OK);
      checks.push(check("pass", "Sensor drivers", `${path.relative(repositoryRoot, project.sensorsDirectory)} is readable`));
    } catch {
      checks.push(check("fail", "Sensor drivers", "Configured sensor driver directory is missing or unreadable"));
    }
  }

  const composeFile = resolvePathInsideRepository(
    repositoryRoot,
    project.config.docker.compose_file,
    "docker.compose_file",
  );
  try {
    await access(composeFile, constants.R_OK);
    const composeValidation = await dependencies.runCommand("docker", [
      "compose",
      "--env-file",
      path.join(repositoryRoot, ".env"),
      "-f",
      composeFile,
      "config",
      "--quiet",
    ]);
    checks.push(
      composeValidation.ok
        ? check(
            "pass",
            "Compose file",
            `${path.relative(repositoryRoot, composeFile)} is valid`,
          )
        : check(
            "fail",
            "Compose file",
            conciseCommandFailure(
              composeValidation,
              `${path.relative(repositoryRoot, composeFile)} is invalid`,
            ),
          ),
    );
  } catch {
    checks.push(
      check(
        "fail",
        "Compose file",
        `${path.relative(repositoryRoot, composeFile)} is missing or unreadable`,
      ),
    );
  }

  const ports = new Map<number, string[]>();
  const addPort = (port: number, service: string): void => {
    ports.set(port, [...(ports.get(port) ?? []), service]);
  };
  addPort(project.config.platform.port, "platform");
  addPort(project.config.database.port, "PostgreSQL");
  addPort(project.config.rabbitmq.port, "RabbitMQ");
  addPort(project.config.rabbitmq.management_port, "RabbitMQ management");
  if (project.config.services.core_api.enabled) addPort(project.config.platform.port, "CoreAPI");
  if (project.config.services.admin_panel.enabled) addPort(project.config.services.admin_panel.port, "Admin Panel");
  if (project.config.services.sim_bridge.enabled) addPort(project.config.sim_bridge.port, "Sim-Bridge");
  if (project.config.services.overlay_web.enabled) addPort(project.config.services.overlay_web.port, "Overlay Web");
  if (ioConfig.enabled && ioConfig.runtime === "host") addPort(ioConfig.health_port, "IO Client health");
  if (project.config.simulator.autostart && project.config.simulator.default === "carla") {
    addPort(project.config.simulator.carla.port, "CARLA RPC");
    addPort(project.config.simulator.carla.port + 1, "CARLA streaming");
    addPort(project.config.simulator.carla.port + 2, "CARLA secondary");
  }

  const portResults = await Promise.all(
    [...ports].map(async ([port, services]) => ({
      port,
      services,
      inUse: await dependencies.isPortInUse(port),
    })),
  );
  for (const result of portResults) {
    checks.push(
      result.inUse
        ? check(
            "warn",
            `Port ${result.port}`,
            `Already in use (${result.services.join(", ")}); this may be a running SCARline service`,
          )
        : check(
            "pass",
            `Port ${result.port}`,
            `Available for ${result.services.join(", ")}`,
          ),
    );
  }

  if (project.config.services.desktop_overlay.enabled) {
    const electron = path.join(repositoryRoot, "node_modules", "electron", "cli.js");
    const hostEntry = path.join(repositoryRoot, "apps", "desktop-overlay", "dist", "main.js");
    try {
      await Promise.all([
        access(electron, constants.R_OK),
        access(hostEntry, constants.R_OK),
      ]);
      checks.push(check("pass", "Desktop overlay", "Electron host is installed and built"));
    } catch {
      checks.push(check("fail", "Desktop overlay", "Electron host is missing or unbuilt; run npm install"));
    }
  }

  const simulator = project.config.simulator;
  if (!simulator.autostart) {
    checks.push(check("pass", "Simulator", "Automatic startup is disabled"));
  } else if (simulator.default === "mock") {
    checks.push(
      simulator.mock.enabled
        ? check("pass", "Simulator", "Mock simulator is enabled")
        : check("fail", "Simulator", "Mock simulator is selected but disabled"),
    );
  } else if (dependencies.platform !== "linux" && dependencies.platform !== "win32") {
    checks.push(
      check(
        "fail",
        "Simulator",
        "CARLA 0.9.16 requires a Linux or Windows host; select mock on this OS",
      ),
    );
  } else if (simulator.carla.executable === null) {
    checks.push(check("fail", "Simulator", "simulator.carla.executable is not configured"));
  } else {
    const executable = path.resolve(repositoryRoot, simulator.carla.executable);
    try {
      await access(executable, constants.R_OK | constants.X_OK);
      checks.push(
        check(
          "pass",
          "Simulator",
          `CARLA ${simulator.carla.version} host executable is accessible; Docker adapter targets ${simulator.carla.host}:${simulator.carla.port}`,
        ),
      );
    } catch {
      checks.push(check("fail", "Simulator", `CARLA host executable is missing or inaccessible: ${executable}`));
    }
  }

  return checks;
}

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, open, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { InfrastructureContext } from "../infrastructure/compose.js";
import { ProjectError } from "../project/errors.js";

interface ProcessRecord {
  version: 1;
  pid: number;
  startedAt: string;
  executable: string;
}

export interface CarlaServerProcessStatus {
  running: boolean;
  healthy: boolean;
  pid: number | null;
}

export interface CarlaServerProcessManager {
  start(context: InfrastructureContext): Promise<CarlaServerProcessStatus>;
  stop(context: InfrastructureContext): Promise<CarlaServerProcessStatus>;
  status(context: InfrastructureContext): Promise<CarlaServerProcessStatus>;
}

export const carlaServerProcessManager: CarlaServerProcessManager = {
  async start(context) {
    requireSupportedPlatform();
    const existing = await processStatus(context);
    if (existing.running) {
      if (existing.healthy) return existing;
      const becameHealthy = await waitForHealthy(context, existing.pid);
      if (becameHealthy) return processStatus(context);
      throw new ProjectError(
        `CARLA is running as PID ${existing.pid ?? "unknown"}, but its RPC endpoint is unavailable. Run scarline stop before retrying.`,
      );
    }

    if (await canConnect(
      context.config.simulator.carla.public_host,
      context.config.simulator.carla.port,
    )) {
      return { running: true, healthy: true, pid: null };
    }

    if (!context.config.simulator.autostart) {
      return { running: false, healthy: false, pid: null };
    }

    const configuredExecutable = context.config.simulator.carla.executable;
    if (configuredExecutable === null) {
      throw new ProjectError(
        "simulator.carla.executable is not configured. Set it to the host CarlaUE4 launcher in config.yml.",
      );
    }
    const executable = path.resolve(context.repositoryRoot, configuredExecutable);
    try {
      await access(executable, constants.R_OK | constants.X_OK);
    } catch {
      throw new ProjectError(`CARLA executable is missing or not executable: ${executable}`);
    }

    const carla = context.config.simulator.carla;
    const runtimeDirectory = path.dirname(context.stateDirectory);
    const log = await open(path.join(runtimeDirectory, "logs", "carla-server.log"), "a", 0o600);
    const child = spawn(
      executable,
      [
        "-RenderOffScreen",
        "-nosound",
        `-quality-level=${carla.quality}`,
        `-carla-rpc-port=${carla.port}`,
        ...carla.additional_arguments,
      ],
      {
        cwd: path.dirname(executable),
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.unref();
    await log.close();
    if (child.pid === undefined) {
      throw new ProjectError("CARLA host process could not be started.");
    }

    await writeRecord(context, {
      version: 1,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      executable,
    });
    if (!(await waitForHealthy(context, child.pid))) {
      await stopProcess(context);
      throw new ProjectError(
        "CARLA exited or did not expose its RPC endpoint before the startup timeout. Check .runtime/logs/carla-server.log.",
      );
    }
    return processStatus(context);
  },
  stop: stopProcess,
  status: processStatus,
};

function requireSupportedPlatform(): void {
  if (process.platform === "darwin") {
    throw new ProjectError("CARLA 0.9.16 cannot run on macOS. Use scarline start --no-sim.");
  }
}

async function processStatus(context: InfrastructureContext): Promise<CarlaServerProcessStatus> {
  const record = await readRecord(context);
  if (record === null) return { running: false, healthy: false, pid: null };
  if (!isAlive(record.pid)) {
    await removeRecord(context);
    return { running: false, healthy: false, pid: null };
  }
  return {
    running: true,
    healthy: await canConnect(
      context.config.simulator.carla.public_host,
      context.config.simulator.carla.port,
    ),
    pid: record.pid,
  };
}

async function stopProcess(context: InfrastructureContext): Promise<CarlaServerProcessStatus> {
  const record = await readRecord(context);
  if (record === null) return { running: false, healthy: false, pid: null };
  if (isAlive(record.pid)) {
    signal(record.pid, "SIGTERM");
    const deadline = Date.now() + context.config.platform.shutdown_timeout_seconds * 1_000;
    while (Date.now() < deadline && isAlive(record.pid)) await delay(100);
    if (isAlive(record.pid)) signal(record.pid, "SIGKILL");
  }
  await removeRecord(context);
  return { running: false, healthy: false, pid: null };
}

async function waitForHealthy(context: InfrastructureContext, pid: number | null): Promise<boolean> {
  if (pid === null) return false;
  const deadline = Date.now() + context.config.platform.startup_timeout_seconds * 1_000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return false;
    if (await canConnect(context.config.simulator.carla.public_host, context.config.simulator.carla.port)) {
      return true;
    }
    await delay(250);
  }
  return false;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function signal(pid: number, signalName: NodeJS.Signals): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signalName);
  } catch (error) {
    const processError = error as NodeJS.ErrnoException;
    if (processError.code === "ESRCH") return;
    if (process.platform !== "win32") {
      try {
        process.kill(pid, signalName);
        return;
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code === "ESRCH") return;
        throw fallbackError;
      }
    }
    throw error;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readRecord(context: InfrastructureContext): Promise<ProcessRecord | null> {
  try {
    const value = JSON.parse(await readFile(recordPath(context), "utf8")) as Partial<ProcessRecord>;
    return value.version === 1
      && Number.isSafeInteger(value.pid)
      && (value.pid ?? 0) > 0
      && typeof value.startedAt === "string"
      && typeof value.executable === "string"
      ? value as ProcessRecord
      : null;
  } catch {
    return null;
  }
}

async function writeRecord(context: InfrastructureContext, record: ProcessRecord): Promise<void> {
  await writeFile(recordPath(context), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

async function removeRecord(context: InfrastructureContext): Promise<void> {
  try {
    await unlink(recordPath(context));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function recordPath(context: InfrastructureContext): string {
  return path.join(path.dirname(context.stateDirectory), "processes", "carla-server.json");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

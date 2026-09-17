import { spawn } from "node:child_process";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { InfrastructureContext } from "../infrastructure/compose.js";
import { ProjectError } from "../project/errors.js";

interface ProcessRecord {
  version: 1;
  pid: number;
  startedAt: string;
}

export interface CarlaDriverProcessStatus {
  running: boolean;
  pid: number | null;
}

export interface CarlaDriverProcessManager {
  start(context: InfrastructureContext): Promise<CarlaDriverProcessStatus>;
  stop(context: InfrastructureContext): Promise<CarlaDriverProcessStatus>;
  status(context: InfrastructureContext): Promise<CarlaDriverProcessStatus>;
}

export const carlaDriverProcessManager: CarlaDriverProcessManager = {
  async start(context) {
    const existing = await processStatus(context);
    if (existing.running) return existing;

    const driverScript = path.join(
      context.repositoryRoot,
      "python",
      "carla-client",
      "scarline_carla",
      "pygame_driver.py",
    );

    const runtimeDirectory = path.dirname(context.stateDirectory);
    const log = await open(
      path.join(runtimeDirectory, "logs", "carla-driver.log"),
      "a",
      0o600,
    );

    const isWindows = process.platform === "win32";
    const executable = isWindows ? "py" : "python3";
    const args = isWindows ? ["-3.12", "-u", driverScript] : ["-u", driverScript];

    let child;
    try {
      child = spawn(executable, args, {
        cwd: context.repositoryRoot,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          ...process.env,
          CARLA_SERVER_HOST: context.config.simulator.carla.public_host,
          CARLA_SERVER_PORT: String(context.config.simulator.carla.port),
        },
      });
    } catch {
      // Fallback to plain python command
      child = spawn("python", ["-u", driverScript], {
        cwd: context.repositoryRoot,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          ...process.env,
          CARLA_SERVER_HOST: context.config.simulator.carla.public_host,
          CARLA_SERVER_PORT: String(context.config.simulator.carla.port),
        },
      });
    }

    child.unref();
    await log.close();

    if (!child.pid) {
      throw new ProjectError("CARLA PyGame keyboard driver process could not be started.");
    }

    await writeRecord(context, {
      version: 1,
      pid: child.pid,
      startedAt: new Date().toISOString(),
    });

    await delay(300);
    const started = await processStatus(context);
    return started;
  },

  async stop(context) {
    const record = await readRecord(context);
    if (record && alive(record.pid)) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const deadline =
        Date.now() + context.config.platform.shutdown_timeout_seconds * 1_000;
      while (Date.now() < deadline && alive(record.pid)) await delay(100);
      if (alive(record.pid)) process.kill(record.pid, "SIGKILL");
    }
    await removeRecord(context);
    return { running: false, pid: null };
  },

  status: processStatus,
};

async function processStatus(
  context: InfrastructureContext,
): Promise<CarlaDriverProcessStatus> {
  const record = await readRecord(context);
  if (record && alive(record.pid)) return { running: true, pid: record.pid };
  if (record) await removeRecord(context);
  return { running: false, pid: null };
}

async function readRecord(
  context: InfrastructureContext,
): Promise<ProcessRecord | null> {
  try {
    const value = JSON.parse(
      await readFile(recordPath(context), "utf8"),
    ) as ProcessRecord;
    return value.version === 1 && Number.isSafeInteger(value.pid) ? value : null;
  } catch {
    return null;
  }
}

async function writeRecord(
  context: InfrastructureContext,
  value: ProcessRecord,
) {
  await writeFile(recordPath(context), `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function removeRecord(context: InfrastructureContext) {
  try {
    await unlink(recordPath(context));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function recordPath(context: InfrastructureContext) {
  return path.join(
    path.dirname(context.stateDirectory),
    "processes",
    "carla-driver.json",
  );
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

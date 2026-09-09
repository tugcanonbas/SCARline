import { spawn } from "node:child_process";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { InfrastructureContext } from "../infrastructure/compose.js";
import { loadEnvironmentSecrets } from "../project/environment.js";
import { ProjectError } from "../project/errors.js";

interface ProcessRecord {
  version: 1;
  pid: number;
  startedAt: string;
}

export interface DesktopOverlayProcessStatus {
  running: boolean;
  pid: number | null;
}

export interface DesktopOverlayProcessManager {
  start(context: InfrastructureContext): Promise<DesktopOverlayProcessStatus>;
  stop(context: InfrastructureContext): Promise<DesktopOverlayProcessStatus>;
  status(context: InfrastructureContext): Promise<DesktopOverlayProcessStatus>;
}

export const desktopOverlayProcessManager: DesktopOverlayProcessManager = {
  async start(context) {
    const existing = await processStatus(context);
    if (existing.running) return existing;
    const electronCli = path.join(context.repositoryRoot, "node_modules", "electron", "cli.js");
    const applicationDirectory = path.join(context.repositoryRoot, "apps", "desktop-overlay");
    const environment = await loadEnvironmentSecrets(context.repositoryRoot);
    const runtimeDirectory = path.dirname(context.stateDirectory);
    const log = await open(path.join(runtimeDirectory, "logs", "desktop-overlay.log"), "a", 0o600);
    const child = spawn(process.execPath, [electronCli, applicationDirectory], {
      cwd: context.repositoryRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
        OVERLAY_CONTROL_SECRET: environment.secrets.OVERLAY_CONTROL_SECRET,
        SCARLINE_CORE_API_ORIGIN: `http://localhost:${context.config.platform.port}`,
        SCARLINE_OVERLAY_WEB_ORIGIN: context.config.services.overlay_web.public_origin,
      },
    });
    child.unref();
    await log.close();
    if (child.pid === undefined) throw new ProjectError("Desktop overlay process could not be started.");
    await writeRecord(context, { version: 1, pid: child.pid, startedAt: new Date().toISOString() });
    await delay(500);
    const started = await processStatus(context);
    if (!started.running) throw new ProjectError("Desktop overlay exited during startup. Check .runtime/logs/desktop-overlay.log.");
    return started;
  },
  async stop(context) {
    const current = await readRecord(context);
    if (current === null) return { running: false, pid: null };
    if (isAlive(current.pid)) {
      try {
        process.kill(current.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const deadline = Date.now() + context.config.platform.shutdown_timeout_seconds * 1_000;
      while (Date.now() < deadline && isAlive(current.pid)) await delay(100);
      if (isAlive(current.pid)) process.kill(current.pid, "SIGKILL");
    }
    await removeRecord(context);
    return { running: false, pid: null };
  },
  status: processStatus,
};

async function processStatus(context: InfrastructureContext): Promise<DesktopOverlayProcessStatus> {
  const record = await readRecord(context);
  if (record === null) return { running: false, pid: null };
  if (isAlive(record.pid)) return { running: true, pid: record.pid };
  await removeRecord(context);
  return { running: false, pid: null };
}

async function readRecord(context: InfrastructureContext): Promise<ProcessRecord | null> {
  try {
    const value = JSON.parse(await readFile(recordPath(context), "utf8")) as Partial<ProcessRecord>;
    return value.version === 1 && Number.isSafeInteger(value.pid) && (value.pid ?? 0) > 0 && typeof value.startedAt === "string"
      ? value as ProcessRecord
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
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
  return path.join(path.dirname(context.stateDirectory), "processes", "desktop-overlay.json");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

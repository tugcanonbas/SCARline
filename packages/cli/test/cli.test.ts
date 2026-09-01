import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { CommandContext } from "../src/command.js";
import { runCli } from "../src/cli.js";
import { commands } from "../src/commands/index.js";
import {
  collectDoctorChecks,
  type DoctorDependencies,
} from "../src/diagnostics/doctor.js";

function captureOutput(): {
  context: CommandContext;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    context: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      cwd: process.cwd(),
    },
    stdout,
    stderr,
  };
}

test("registers the initial command set", () => {
  assert.deepEqual(
    commands.map(({ name }) => name),
    ["setup", "start", "stop", "restart", "status", "doctor", "logs"],
  );
});

test("prints root help when no command is provided", async () => {
  const output = captureOutput();

  assert.equal(await runCli([], output.context), 0);
  assert.match(output.stdout.join("\n"), /Usage: scarline <command>/);
  assert.equal(output.stderr.length, 0);
});

test("runs unimplemented commands as placeholders", async () => {
  for (const command of commands.filter(
    ({ name }) =>
      !["setup", "start", "stop", "status", "doctor"].includes(name),
  )) {
    const output = captureOutput();

    assert.equal(await runCli([command.name], output.context), 0);
    assert.deepEqual(output.stdout, [
      `The scarline ${command.name} command is not implemented yet.`,
    ]);
    assert.equal(output.stderr.length, 0);
  }
});

test("prints command help without running the command", async () => {
  const output = captureOutput();

  assert.equal(await runCli(["doctor", "--help"], output.context), 0);
  assert.match(output.stdout.join("\n"), /Usage: scarline doctor/);
  assert.doesNotMatch(output.stdout.join("\n"), /not implemented/);
});

test("reports an unknown command", async () => {
  const output = captureOutput();

  assert.equal(await runCli(["unknown"], output.context), 1);
  assert.match(output.stderr.join("\n"), /Unknown command: unknown/);
  assert.equal(output.stdout.length, 0);
});

test("runs the compiled CLI entry point", () => {
  const entryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [entryPoint, "status", "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: scarline status/);
  assert.equal(result.stderr, "");
});

const VALID_CONFIG = `version: 1
bootstrap:
  admin_username: admin
api:
  allowed_origins: [http://localhost:5173]
  command_timeout_seconds: 30
  access_token_ttl_minutes: 15
  refresh_token_ttl_days: 30
  overlay_token_ttl_minutes: 5
  overlay_renderer_session_ttl_hours: 12
  pagination_default_limit: 50
  pagination_max_limit: 200
  event_batch_size: 100
  event_flush_milliseconds: 250
  exports_directory: ./.runtime/exports
  widgets_directory: ./widgets
  sensors_directory: ./services/io-client/drivers
platform:
  environment: test
  port: 8088
  runtime_directory: ./.runtime
  open_browser: false
  startup_timeout_seconds: 120
  shutdown_timeout_seconds: 30
docker:
  compose_file: compose.yml
  project_name: scarline
  remove_orphans: true
database:
  host: database
  port: 5432
  name: scarline
  user: scarline
rabbitmq:
  host: rabbitmq
  port: 5672
  management_port: 15672
  user: scarline
sim_bridge:
  host: sim-bridge
  public_host: 127.0.0.1
  port: 9000
  adapter_path: /adapter
  adapter_command_timeout_seconds: 20
  adapter_heartbeat_interval_seconds: 5
  adapter_stale_timeout_seconds: 15
  adapter_reconnect_grace_seconds: 10
  maximum_websocket_message_bytes: 1048576
  telemetry_maximum_hz: 100
  command_journal: ./.runtime/sim-bridge/command-journal.json
simulator:
  default: mock
  autostart: true
  carla:
    version: 0.9.16
    executable: null
    public_host: 127.0.0.1
    host: host.docker.internal
    port: 2000
    quality: Epic
    additional_arguments: []
    synchronous_mode: true
    fixed_delta_seconds: 0.05
    adapter_id: carla-primary
    priority: 10
    reconnect_interval_seconds: 2
    health_port: 8082
    command_journal: ./.runtime/carla-client/command-journal.json
    media_directory: ./.runtime/carla-client/media
    control_timeout_milliseconds: 500
  mock:
    enabled: true
    telemetry_hz: 20
    adapter_id: mock-primary
    priority: 100
    reconnect_interval_seconds: 2
    command_journal: ./.runtime/mock-simulator/command-journal.json
services:
  core_api: { enabled: true }
  admin_panel: { enabled: true, port: 5173 }
  sim_bridge: { enabled: true }
  overlay_web: { enabled: true, port: 4000, public_origin: http://localhost:4000 }
  desktop_overlay: { enabled: true }
  io_client: { enabled: false, runtime: host, python_executable: python3, heartbeat_interval_seconds: 5, stale_timeout_seconds: 15, health_port: 8081, command_journal: ./.runtime/io-client/command-journal.json, media_directory: ./.runtime/io-client/media, mock_enabled: true, batch_max_samples: 100, batch_max_milliseconds: 100 }
logging:
  level: info
  directory: ./.runtime/logs
`;

async function createTestRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "scarline-cli-test-"));
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"name":"scarline"}\n'),
    writeFile(path.join(root, "config.yml"), VALID_CONFIG),
    writeFile(
      path.join(root, ".env.example"),
      "# CoreAPI one-time administrator secret\nBOOTSTRAP_ADMIN_PASSWORD=scarline\n",
    ),
  ]);
  return root;
}

test("setup discovers the repository, generates secrets, and creates runtime directories", async () => {
  const root = await createTestRepository();
  const nestedDirectory = path.join(root, "packages", "example");
  await mkdir(nestedDirectory, { recursive: true });
  const output = captureOutput();
  output.context.cwd = nestedDirectory;

  assert.equal(await runCli(["setup"], output.context), 0);
  assert.match(output.stdout.join("\n"), /SCARline setup complete/);
  assert.doesNotMatch(output.stdout.join("\n"), /JWT_ACCESS_SECRET=/);
  assert.equal(output.stderr.length, 0);

  const env = await readFile(path.join(root, ".env"), "utf8");
  const assignments = Object.fromEntries(
    env
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => line.split("=", 2) as [string, string]),
  );
  assert.deepEqual(Object.keys(assignments), [
    "POSTGRES_PASSWORD",
    "RABBITMQ_DEFAULT_PASS",
    "JWT_ACCESS_SECRET",
    "REFRESH_TOKEN_PEPPER",
    "BOOTSTRAP_ADMIN_PASSWORD",
    "OVERLAY_CONTROL_SECRET",
    "SIM_BRIDGE_ADAPTER_SECRET",
  ]);
  assert.equal(assignments.BOOTSTRAP_ADMIN_PASSWORD, "scarline");
  assert.ok(
    Object.entries(assignments)
      .filter(([key]) => key !== "BOOTSTRAP_ADMIN_PASSWORD")
      .every(([, value]) => value.length >= 32),
  );
  assert.equal(new Set(Object.values(assignments)).size, 7);

  for (const directory of ["logs", "processes", "state", "postgres", "rabbitmq", "sim-bridge", "mock-simulator", "carla-client", "carla-client/media"]) {
    assert.ok((await stat(path.join(root, ".runtime", directory))).isDirectory());
  }

  if (process.platform !== "win32") {
    assert.equal((await stat(path.join(root, ".env"))).mode & 0o777, 0o600);
  }
});

test("setup preserves existing secrets and only fills missing values", async () => {
  const root = await createTestRepository();
  await writeFile(
    path.join(root, ".env"),
    "# PostgreSQL secrets\nPOSTGRES_PASSWORD=keep-this-database-password\n",
  );
  const output = captureOutput();
  output.context.cwd = root;

  assert.equal(await runCli(["setup"], output.context), 0);
  const env = await readFile(path.join(root, ".env"), "utf8");
  assert.match(env, /POSTGRES_PASSWORD=keep-this-database-password/);
  assert.equal(env.match(/POSTGRES_PASSWORD=/g)?.length, 1);
  assert.match(output.stdout.join("\n"), /added 6 missing secret values/);

  const secondOutput = captureOutput();
  secondOutput.context.cwd = root;
  assert.equal(await runCli(["setup"], secondOutput.context), 0);
  assert.match(secondOutput.stdout.join("\n"), /existing secrets preserved/);
  assert.equal(await readFile(path.join(root, ".env"), "utf8"), env);
});

test("setup validates config before writing runtime data", async () => {
  const root = await createTestRepository();
  await writeFile(path.join(root, "config.yml"), "version: 2\n");
  const output = captureOutput();
  output.context.cwd = root;

  assert.equal(await runCli(["setup"], output.context), 1);
  assert.match(output.stderr.join("\n"), /Invalid config.yml/);
  await assert.rejects(readFile(path.join(root, ".env"), "utf8"), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, ".runtime")), { code: "ENOENT" });
});

test("setup does not modify an invalid existing environment file", async () => {
  const root = await createTestRepository();
  const invalidEnvironment = "JWT_ACCESS_SECRET=too-short\n";
  await writeFile(path.join(root, ".env"), invalidEnvironment);
  const output = captureOutput();
  output.context.cwd = root;

  assert.equal(await runCli(["setup"], output.context), 1);
  assert.match(output.stderr.join("\n"), /Invalid \.env/);
  assert.equal(await readFile(path.join(root, ".env"), "utf8"), invalidEnvironment);
  await assert.rejects(stat(path.join(root, ".runtime")), { code: "ENOENT" });
});

test("setup rejects paths that escape the repository", async () => {
  const root = await createTestRepository();
  await writeFile(
    path.join(root, "config.yml"),
    VALID_CONFIG.replace("runtime_directory: ./.runtime", "runtime_directory: ../outside"),
  );
  const output = captureOutput();
  output.context.cwd = root;

  assert.equal(await runCli(["setup"], output.context), 1);
  assert.match(output.stderr.join("\n"), /must resolve inside the repository/);
});

const HEALTHY_DOCTOR_DEPENDENCIES: DoctorDependencies = {
  nodeVersion: "22.0.0",
  platform: "linux",
  async runCommand(command, args) {
    if (command === "npm") {
      return { ok: true, output: "10.0.0" };
    }
    if (args[0] === "--version") {
      return { ok: true, output: "Docker version 27.0.0" };
    }
    if (args[0] === "compose") {
      return { ok: true, output: "Docker Compose version v2.29.0" };
    }
    return { ok: true, output: "27.0.0" };
  },
  async isPortInUse() {
    return false;
  },
};

test("doctor passes a fully prepared repository", async () => {
  const root = await createTestRepository();
  const setupOutput = captureOutput();
  setupOutput.context.cwd = root;
  assert.equal(await runCli(["setup"], setupOutput.context), 0);
  await writeFile(path.join(root, "compose.yml"), "services: {}\n");
  await Promise.all([
    mkdir(path.join(root, "node_modules", "electron"), { recursive: true }),
    mkdir(path.join(root, "apps", "desktop-overlay", "dist"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "node_modules", "electron", "cli.js"), "#!/usr/bin/env node\n"),
    writeFile(path.join(root, "apps", "desktop-overlay", "dist", "main.js"), "export {};\n"),
  ]);

  const checks = await collectDoctorChecks(root, HEALTHY_DOCTOR_DEPENDENCIES);
  assert.equal(checks.filter(({ status }) => status === "fail").length, 0);
  assert.ok(checks.some(({ name }) => name === "Docker daemon"));
  assert.ok(checks.some(({ name }) => name === "Runtime layout"));
  assert.ok(checks.some(({ name }) => name === "Simulator"));
  assert.ok(checks.some(({ name }) => name === "Desktop overlay"));
  assert.ok(checks.some(({ name, detail }) => name === "Port 5173" && detail.includes("Admin Panel")));
});

test("doctor reports missing setup data and infrastructure", async () => {
  const root = await createTestRepository();
  const unhealthyDependencies: DoctorDependencies = {
    ...HEALTHY_DOCTOR_DEPENDENCIES,
    async runCommand(command, args) {
      if (command === "npm") {
        return { ok: true, output: "10.0.0" };
      }
      if (args[0] === "info") {
        return { ok: true, output: "permission denied connecting to daemon" };
      }
      return { ok: false, output: "" };
    },
  };

  const checks = await collectDoctorChecks(root, unhealthyDependencies);
  assert.ok(
    checks.some(({ name, status }) => name === "Secrets" && status === "fail"),
  );
  assert.ok(
    checks.some(({ name, status }) => name === "Runtime" && status === "fail"),
  );
  assert.ok(
    checks.some(
      ({ name, status }) => name === "Compose file" && status === "fail",
    ),
  );
  assert.ok(
    checks.some(({ name, status }) => name === "Docker" && status === "fail"),
  );
  assert.ok(
    checks.some(
      ({ name, status }) => name === "Docker daemon" && status === "fail",
    ),
  );
});

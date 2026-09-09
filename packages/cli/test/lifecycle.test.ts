import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { CommandContext } from "../src/command.js";
import { createStartCommand } from "../src/commands/start.js";
import { createStatusCommand } from "../src/commands/status.js";
import { createStopCommand } from "../src/commands/stop.js";
import type {
  ComposeExecution,
  ComposeRunner,
  ComposeServiceStatus,
} from "../src/infrastructure/compose.js";
import {
  classifyInfrastructure,
  parseComposeStatus,
} from "../src/infrastructure/compose.js";
import type { DesktopOverlayProcessManager } from "../src/processes/desktop-overlay.js";
import type { IoClientProcessManager } from "../src/processes/io-client.js";
import type { CarlaServerProcessManager } from "../src/processes/carla-server.js";

const CONFIG = `version: 1
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
    executable: /opt/carla/CarlaUE4.sh
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

const ENVIRONMENT = `POSTGRES_PASSWORD=database-secret-value-with-32-characters
RABBITMQ_DEFAULT_PASS=rabbit-secret-value-with-32-characters
JWT_ACCESS_SECRET=jwt-secret-value-with-at-least-32-characters
REFRESH_TOKEN_PEPPER=refresh-secret-value-with-at-least-32-characters
BOOTSTRAP_ADMIN_PASSWORD=scarline
OVERLAY_CONTROL_SECRET=overlay-secret-value-with-at-least-32-characters
SIM_BRIDGE_ADAPTER_SECRET=sim-bridge-secret-value-with-at-least-32-characters
`;

const HEALTHY_SERVICES: readonly ComposeServiceStatus[] = [
  {
    service: "admin-panel",
    name: "scarline-admin-panel-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
  {
    service: "core-api",
    name: "scarline-core-api-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
  {
    service: "database",
    name: "scarline-database-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
  {
    service: "mock-simulator",
    name: "scarline-mock-simulator-1",
    state: "running",
    health: "",
    exitCode: 0,
  },
  {
    service: "overlay-web",
    name: "scarline-overlay-web-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
  {
    service: "rabbitmq",
    name: "scarline-rabbitmq-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
  {
    service: "sim-bridge",
    name: "scarline-sim-bridge-1",
    state: "running",
    health: "healthy",
    exitCode: 0,
  },
];

const HEALTHY_CARLA_SERVICES: readonly ComposeServiceStatus[] = [
  ...HEALTHY_SERVICES.filter(({ service }) => service !== "mock-simulator"),
  { service: "carla-client", name: "scarline-carla-client-1", state: "running", health: "healthy", exitCode: 0 },
];

function composeJson(services: readonly ComposeServiceStatus[]): string {
  return JSON.stringify(
    services.map((service) => ({
      Service: service.service,
      Name: service.name,
      State: service.state,
      Health: service.health,
      ExitCode: service.exitCode,
    })),
  );
}

class FakeComposeRunner implements ComposeRunner {
  services: readonly ComposeServiceStatus[] = [];
  readonly calls: string[][] = [];
  failure?: ComposeExecution;

  async run(args: readonly string[]): Promise<ComposeExecution> {
    this.calls.push([...args]);

    if (args.includes("up")) {
      if (this.failure !== undefined) {
        return this.failure;
      }
      this.services = args.includes("carla") ? HEALTHY_CARLA_SERVICES : HEALTHY_SERVICES;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args.includes("down")) {
      if (this.failure !== undefined) {
        return this.failure;
      }
      this.services = [];
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args.includes("ps")) {
      return {
        exitCode: 0,
        stdout: composeJson(this.services),
        stderr: "",
      };
    }
    return { exitCode: 1, stdout: "", stderr: "Unexpected command" };
  }
}

class FakeDesktopOverlayManager implements DesktopOverlayProcessManager {
  running = false;

  async start() {
    this.running = true;
    return { running: true, pid: 1234 };
  }

  async stop() {
    this.running = false;
    return { running: false, pid: null };
  }

  async status() {
    return { running: this.running, pid: this.running ? 1234 : null };
  }
}

class FakeIoClientManager implements IoClientProcessManager {
  running = false;
  starts = 0;
  stops = 0;
  async start(_context: never, mockEnabled = true) { this.running = true; this.starts += 1; return { running:true, healthy:true, pid:5678, mockEnabled }; }
  async stop() { this.running = false; this.stops += 1; return { running:false, healthy:false, pid:null, mockEnabled:false }; }
  async status() { return { running:this.running, healthy:this.running, pid:this.running?5678:null, mockEnabled:this.running }; }
}

class FakeCarlaServerManager implements CarlaServerProcessManager {
  running = false;
  healthy = false;
  starts = 0;
  stops = 0;
  async start() {
    this.running = true;
    this.healthy = true;
    this.starts += 1;
    return { running: true, healthy: true, pid: 9016 };
  }
  async stop() {
    this.running = false;
    this.healthy = false;
    this.stops += 1;
    return { running: false, healthy: false, pid: null };
  }
  async status() {
    return { running: this.running, healthy: this.healthy, pid: this.running ? 9016 : null };
  }
}

function captureOutput(cwd: string): {
  context: CommandContext;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    context: {
      cwd,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

async function createRepository(config = CONFIG): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "scarline-lifecycle-test-"));
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"name":"scarline"}\n'),
    writeFile(path.join(root, "config.yml"), config),
    writeFile(
      path.join(root, ".env.example"),
      "BOOTSTRAP_ADMIN_PASSWORD=scarline\n",
    ),
    writeFile(path.join(root, ".env"), ENVIRONMENT, { mode: 0o600 }),
    writeFile(path.join(root, "compose.yml"), "services: {}\n"),
    mkdir(path.join(root, ".runtime", "state"), { recursive: true }),
  ]);
  return root;
}

test("start, status, and stop manage one idempotent infrastructure lifecycle", async () => {
  const root = await createRepository();
  const runner = new FakeComposeRunner();
  const desktop = new FakeDesktopOverlayManager();

  const startOutput = captureOutput(root);
  assert.equal(await createStartCommand(runner, desktop).run([], startOutput.context), 0);
  assert.match(startOutput.stdout.join("\n"), /infrastructure started/);
  assert.equal(runner.calls.filter((args) => args.includes("up")).length, 1);
  const startCall = runner.calls.find((args) => args.includes("up"));
  assert.ok(startCall);
  assert.equal(startCall[startCall.indexOf("--profile") + 1], "mock");

  const secondStartOutput = captureOutput(root);
  assert.equal(
    await createStartCommand(runner, desktop).run([], secondStartOutput.context),
    0,
  );
  assert.match(secondStartOutput.stdout.join("\n"), /already running/);
  assert.equal(runner.calls.filter((args) => args.includes("up")).length, 1);

  const statusOutput = captureOutput(root);
  assert.equal(
    await createStatusCommand(runner, desktop).run([], statusOutput.context),
    0,
  );
  assert.match(statusOutput.stdout.join("\n"), /infrastructure is running/);
  assert.match(statusOutput.stdout.join("\n"), /database: running, healthy/);

  const stopOutput = captureOutput(root);
  assert.equal(await createStopCommand(runner, desktop).run([], stopOutput.context), 0);
  assert.match(stopOutput.stdout.join("\n"), /Runtime data was preserved/);
  assert.equal(runner.calls.filter((args) => args.includes("down")).length, 1);
  const stopCall = runner.calls.find((args) => args.includes("down"));
  assert.ok(stopCall);
  assert.equal(stopCall[stopCall.indexOf("--profile") + 1], "mock");

  const secondStopOutput = captureOutput(root);
  assert.equal(
    await createStopCommand(runner, desktop).run([], secondStopOutput.context),
    0,
  );
  assert.match(secondStopOutput.stdout.join("\n"), /already stopped/);
  assert.equal(runner.calls.filter((args) => args.includes("down")).length, 1);

  const finalStatusOutput = captureOutput(root);
  assert.equal(
    await createStatusCommand(runner, desktop).run([], finalStatusOutput.context),
    0,
  );
  assert.match(finalStatusOutput.stdout.join("\n"), /infrastructure is stopped/);

  const state = JSON.parse(
    await readFile(path.join(root, ".runtime", "state", "platform.json"), "utf8"),
  ) as { phase: string; services: unknown[] };
  assert.equal(state.phase, "stopped");
  assert.deepEqual(state.services, []);
});

test("starts the host CARLA server before its Docker adapter profile", async () => {
  const root = await createRepository(CONFIG.replace("default: mock", "default: carla"));
  const runner = new FakeComposeRunner();
  const desktop = new FakeDesktopOverlayManager();
  const io = new FakeIoClientManager();
  const carla = new FakeCarlaServerManager();
  const output = captureOutput(root);

  assert.equal(
    await createStartCommand(runner, desktop, io, "linux", carla).run([], output.context),
    0,
  );
  const startCall = runner.calls.find((call) => call.includes("up"));
  assert.ok(startCall);
  assert.ok(startCall.some(
    (value, index) => value === "--profile" && startCall[index + 1] === "carla",
  ));
  assert.match(
    output.stdout.join("\n"),
    /CARLA 0\.9\.16 host server with Docker adapter/,
  );
  assert.equal(carla.starts, 1);
  assert.equal(await createStatusCommand(runner, desktop, io, carla).run([], captureOutput(root).context), 0);
  assert.equal(await createStopCommand(runner, desktop, io, carla).run([], captureOutput(root).context), 0);
  assert.equal(carla.stops, 1);
});

test("rolls back a newly started host CARLA server when its adapter fails", async () => {
  const root = await createRepository(CONFIG.replace("default: mock", "default: carla"));
  const runner = new FakeComposeRunner();
  runner.failure = { exitCode: 1, stdout: "", stderr: "adapter failed" };
  const carla = new FakeCarlaServerManager();

  assert.equal(
    await createStartCommand(
      runner,
      new FakeDesktopOverlayManager(),
      new FakeIoClientManager(),
      "linux",
      carla,
    ).run([], captureOutput(root).context),
    1,
  );
  assert.equal(carla.starts, 1);
  assert.equal(carla.stops, 1);
  assert.equal(carla.running, false);
});

test("reports a running CARLA adapter without its host server as degraded", async () => {
  const root = await createRepository();
  const runner = new FakeComposeRunner();
  runner.services = HEALTHY_CARLA_SERVICES;
  const output = captureOutput(root);

  assert.equal(
    await createStatusCommand(
      runner,
      new FakeDesktopOverlayManager(),
      new FakeIoClientManager(),
      new FakeCarlaServerManager(),
    ).run([], output.context),
    1,
  );
  assert.match(output.stdout.join("\n"), /carla-server: stopped/);
  assert.match(output.stdout.join("\n"), /infrastructure is degraded/);
});

test("CLI owns the host IO Client lifecycle when enabled", async () => {
  const root = await createRepository(CONFIG.replace("io_client: { enabled: false", "io_client: { enabled: true"));
  const runner = new FakeComposeRunner(); const desktop = new FakeDesktopOverlayManager(); const io = new FakeIoClientManager();
  assert.equal(await createStartCommand(runner, desktop, io).run(["--mock-io"], captureOutput(root).context), 0);
  assert.equal(io.starts, 1); assert.equal(io.running, true);
  assert.equal(await createStatusCommand(runner, desktop, io).run([], captureOutput(root).context), 0);
  assert.equal(await createStopCommand(runner, desktop, io).run([], captureOutput(root).context), 0);
  assert.equal(io.stops, 1); assert.equal(io.running, false);
});

test("start redacts environment secrets from Docker failures", async () => {
  const root = await createRepository();
  const runner = new FakeComposeRunner();
  runner.failure = {
    exitCode: 1,
    stdout: "",
    stderr: "authentication failed: database-secret-value-with-32-characters",
  };
  const output = captureOutput(root);

  assert.equal(await createStartCommand(runner).run([], output.context), 1);
  assert.match(output.stderr.join("\n"), /\[REDACTED\]/);
  assert.doesNotMatch(
    output.stderr.join("\n"),
    /database-secret-value-with-32-characters/,
  );
});

test("status parsing supports array and newline-delimited Compose JSON", () => {
  assert.deepEqual(parseComposeStatus(composeJson(HEALTHY_SERVICES)), HEALTHY_SERVICES);

  const newlineJson = HEALTHY_SERVICES.map((service) =>
    JSON.stringify({
      Service: service.service,
      Name: service.name,
      State: service.state,
      Health: service.health,
      ExitCode: service.exitCode,
    }),
  ).join("\n");
  assert.deepEqual(parseComposeStatus(newlineJson), HEALTHY_SERVICES);
});

test("status classification distinguishes starting and degraded services", () => {
  assert.equal(classifyInfrastructure([]), "stopped");
  assert.equal(classifyInfrastructure(HEALTHY_SERVICES), "running");
  assert.equal(
    classifyInfrastructure([
      { ...HEALTHY_SERVICES[0]!, health: "starting" },
      HEALTHY_SERVICES[1]!,
    ]),
    "starting",
  );
  assert.equal(
    classifyInfrastructure([
      { ...HEALTHY_SERVICES[0]!, state: "exited", health: "unhealthy", exitCode: 1 },
      HEALTHY_SERVICES[1]!,
    ]),
    "degraded",
  );
});

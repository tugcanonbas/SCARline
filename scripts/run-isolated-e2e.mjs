import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a local port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "scarline-e2e-"));
const composePath = path.join(temporaryRoot, "compose.yml");
const configPath = path.join(temporaryRoot, "config.yml");
const environmentPath = path.join(temporaryRoot, ".env");
const exportsDirectory = path.join(temporaryRoot, "exports");
const simBridgeRuntime = path.join(temporaryRoot, "sim-bridge-runtime");
const mockRuntime = path.join(temporaryRoot, "mock-runtime");
const projectName = `scarline-e2e-${randomBytes(4).toString("hex")}`;
const ports = {
  database: await freePort(),
  rabbitmq: await freePort(),
  rabbitmqManagement: await freePort(),
  core: await freePort(),
  admin: await freePort(),
  overlay: await freePort(),
  simBridge: await freePort(),
};
const adminOrigin = `http://127.0.0.1:${ports.admin}`;
const coreOrigin = `http://127.0.0.1:${ports.core}`;
const overlayOrigin = `http://127.0.0.1:${ports.overlay}`;
const adminUsername = "admin";
const initialPassword = `Bootstrap-${randomBytes(18).toString("base64url")}!`;
const adminPassword = `Verified-${randomBytes(18).toString("base64url")}!`;
const secrets = {
  POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
  RABBITMQ_DEFAULT_PASS: randomBytes(24).toString("base64url"),
  JWT_ACCESS_SECRET: randomBytes(48).toString("base64url"),
  REFRESH_TOKEN_PEPPER: randomBytes(48).toString("base64url"),
  BOOTSTRAP_ADMIN_PASSWORD: initialPassword,
  OVERLAY_CONTROL_SECRET: randomBytes(48).toString("base64url"),
  SIM_BRIDGE_ADAPTER_SECRET: randomBytes(48).toString("base64url"),
};

const commonSecrets = Object.fromEntries(Object.keys(secrets).map((key) => [key, `\${${key}}`]));
const compose = {
  services: {
    database: {
      build: { context: path.join(repositoryRoot, "infra/database") },
      environment: { POSTGRES_DB: "scarline", POSTGRES_USER: "scarline", POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}" },
      healthcheck: { test: ["CMD-SHELL", "pg_isready --quiet --host 127.0.0.1 --username scarline --dbname scarline"], interval: "2s", timeout: "3s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.database}:5432`],
      volumes: ["database:/var/lib/postgresql/data"],
    },
    rabbitmq: {
      image: "rabbitmq:4-management-alpine",
      environment: { RABBITMQ_DEFAULT_USER: "scarline", RABBITMQ_DEFAULT_PASS: "${RABBITMQ_DEFAULT_PASS}" },
      healthcheck: { test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"], interval: "3s", timeout: "5s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.rabbitmq}:5672`, `127.0.0.1:${ports.rabbitmqManagement}:15672`],
      volumes: ["rabbitmq:/var/lib/rabbitmq"],
    },
    "core-api": {
      build: { context: repositoryRoot, dockerfile: "services/core-api/Dockerfile" },
      environment: commonSecrets,
      depends_on: { database: { condition: "service_healthy" }, rabbitmq: { condition: "service_healthy" } },
      healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8088/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval: "2s", timeout: "3s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.core}:8088`],
      volumes: [`${configPath}:/app/config.yml:ro`, `${exportsDirectory}:/app/.runtime/exports`, `${path.join(repositoryRoot, "widgets")}:/app/widgets:ro`, `${path.join(repositoryRoot, "services/io-client/drivers")}:/app/services/io-client/drivers:ro`],
    },
    "admin-panel": {
      build: { context: repositoryRoot, dockerfile: "apps/admin-panel/Dockerfile" },
      environment: {
        CORE_API_ORIGIN: "http://core-api:8088/api/v1",
        PUBLIC_CORE_API_ORIGIN: `${coreOrigin}/api/v1`,
        PUBLIC_CORE_API_WEBSOCKET_ORIGIN: coreOrigin.replace(/^http/, "ws"),
        ORIGIN: adminOrigin,
        SCARLINE_RUNTIME_DIRECTORY: ".runtime",
        SCARLINE_PLATFORM_PORT: "8088",
        SCARLINE_SIMULATOR_DEFAULT: "mock",
        CARLA_SERVER_PORT: "2000",
        SCARLINE_WIDGETS_DIRECTORY: "/app/widgets",
      },
      depends_on: { "core-api": { condition: "service_healthy" } },
      healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:5173/admin/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval: "2s", timeout: "3s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.admin}:5173`],
    },
    "overlay-web": {
      build: { context: repositoryRoot, dockerfile: "apps/overlay-web/Dockerfile" },
      environment: { PORT: "4000", CORE_API_PUBLIC_ORIGIN: coreOrigin, CORE_API_PUBLIC_WS_ORIGIN: coreOrigin.replace(/^http/, "ws"), WIDGETS_DIRECTORY: "/app/widgets" },
      depends_on: { "core-api": { condition: "service_healthy" } },
      healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval: "2s", timeout: "3s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.overlay}:4000`],
    },
    "sim-bridge": {
      build: { context: repositoryRoot, dockerfile: "services/sim-bridge/Dockerfile" },
      environment: { RABBITMQ_DEFAULT_PASS: "${RABBITMQ_DEFAULT_PASS}", SIM_BRIDGE_ADAPTER_SECRET: "${SIM_BRIDGE_ADAPTER_SECRET}" },
      depends_on: { rabbitmq: { condition: "service_healthy" } },
      healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:9000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval: "2s", timeout: "3s", retries: 30, start_period: "5s" },
      ports: [`127.0.0.1:${ports.simBridge}:9000`],
      volumes: [`${configPath}:/app/config.yml:ro`, `${simBridgeRuntime}:/app/.runtime/sim-bridge`],
    },
    "mock-simulator": {
      build: { context: repositoryRoot, dockerfile: "services/mock-simulator/Dockerfile" },
      environment: { SIM_BRIDGE_ADAPTER_SECRET: "${SIM_BRIDGE_ADAPTER_SECRET}" },
      depends_on: { "sim-bridge": { condition: "service_healthy" } },
      volumes: [`${configPath}:/app/config.yml:ro`, `${mockRuntime}:/app/.runtime/mock-simulator`],
    },
  },
  volumes: { database: {}, rabbitmq: {} },
};

let composeStarted = false;
try {
  await Promise.all([
    mkdir(exportsDirectory, { recursive: true }),
    mkdir(simBridgeRuntime, { recursive: true }),
    mkdir(mockRuntime, { recursive: true }),
  ]);
  await Promise.all([
    chmod(exportsDirectory, 0o777),
    chmod(simBridgeRuntime, 0o777),
    chmod(mockRuntime, 0o777),
  ]);
  const config = YAML.parse(await readFile(path.join(repositoryRoot, "config.yml"), "utf8"));
  config.bootstrap.admin_username = adminUsername;
  config.api.allowed_origins = [adminOrigin, overlayOrigin];
  config.api.command_timeout_seconds = 10;
  config.platform.open_browser = false;
  config.services.admin_panel.port = ports.admin;
  config.services.overlay_web.port = ports.overlay;
  config.services.overlay_web.public_origin = overlayOrigin;
  config.services.desktop_overlay.enabled = true;
  config.services.io_client.enabled = false;
  await writeFile(configPath, YAML.stringify(config), { mode: 0o644 });
  await writeFile(environmentPath, `${Object.entries(secrets).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
  await writeFile(composePath, YAML.stringify(compose), { mode: 0o644 });

  const composeArgs = ["compose", "--project-name", projectName, "--env-file", environmentPath, "-f", composePath];
  composeStarted = true;
  await run("docker", [...composeArgs, "up", "-d", "--build", "--wait"]);

  const sharedEnvironment = {
    SCARLINE_SMOKE_ENV_PATH: environmentPath,
    SCARLINE_SMOKE_EXPORT_DIRECTORY: exportsDirectory,
    SCARLINE_SMOKE_POSTGRES_HOST: "127.0.0.1",
    SCARLINE_SMOKE_POSTGRES_PORT: String(ports.database),
    SCARLINE_SMOKE_ORIGIN: adminOrigin,
    SCARLINE_SMOKE_BASE_URL: coreOrigin,
    SCARLINE_SMOKE_ADMIN_BASE_URL: `${adminOrigin}/admin`,
  };
  await run("node", ["services/core-api/scripts/live-smoke.mjs"], { env: sharedEnvironment });
  await run("npx", ["playwright", "test"], {
    env: {
      SCARLINE_E2E_ADMIN_ORIGIN: adminOrigin,
      SCARLINE_E2E_CORE_ORIGIN: coreOrigin,
      SCARLINE_E2E_OVERLAY_ORIGIN: overlayOrigin,
      SCARLINE_E2E_ADMIN_USERNAME: adminUsername,
      SCARLINE_E2E_ADMIN_INITIAL_PASSWORD: initialPassword,
      SCARLINE_E2E_ADMIN_PASSWORD: adminPassword,
    },
  });
} catch (error) {
  if (composeStarted) {
    await run("docker", ["compose", "--project-name", projectName, "--env-file", environmentPath, "-f", composePath, "logs", "--no-color", "--tail", "200"]).catch(() => undefined);
  }
  throw error;
} finally {
  if (composeStarted) {
    await run("docker", ["compose", "--project-name", projectName, "--env-file", environmentPath, "-f", composePath, "down", "--volumes", "--remove-orphans"]).catch(() => undefined);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

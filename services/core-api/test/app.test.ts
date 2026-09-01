import assert from "node:assert/strict";
import test from "node:test";

import type { PlatformHealth } from "@scarline/contracts";

import { buildApp } from "../src/app.js";
import { loadCoreApiConfig } from "../src/config.js";
import type { CoreApiRuntime } from "../src/runtime.js";
import { hashPassword } from "../src/security/password.js";

function health(status: PlatformHealth["status"]): PlatformHealth {
  const checkedAt = new Date().toISOString();
  return {
    status,
    checkedAt,
    components: [
      {
        componentId: "core-api",
        status: status === "healthy" ? "healthy" : "starting",
        checkedAt,
        message: null,
        metadata: {},
      },
    ],
  };
}

class FakeRuntime implements CoreApiRuntime {
  started = false;
  stopped = false;
  ready = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  liveness(): PlatformHealth {
    return health("healthy");
  }

  async readiness(): Promise<PlatformHealth> {
    return health(this.ready ? "healthy" : "degraded");
  }
}

test("separates liveness from dependency readiness", async () => {
  const runtime = new FakeRuntime();
  const app = await buildApp({ runtime, logger: false });

  const liveness = await app.inject({ method: "GET", url: "/health" });
  assert.equal(runtime.started, true);
  assert.equal(liveness.statusCode, 200);
  assert.equal(liveness.json().status, "healthy");

  const unavailable = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(unavailable.statusCode, 503);

  runtime.ready = true;
  const ready = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(ready.statusCode, 200);

  await app.close();
  assert.equal(runtime.stopped, true);
});

test("returns the shared error envelope for unknown routes", async () => {
  const app = await buildApp({ runtime: new FakeRuntime(), logger: false });
  const response = await app.inject({ method: "GET", url: "/missing" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json().success, false);
  assert.equal(response.json().error.code, "NOT_FOUND");
  assert.equal(typeof response.json().error.requestId, "string");
  await app.close();
});

test("loads repository configuration with only the declared secrets", async () => {
  const config = await loadCoreApiConfig(undefined, {
    POSTGRES_PASSWORD: "database-password",
    RABBITMQ_DEFAULT_PASS: "rabbitmq-password",
    JWT_ACCESS_SECRET: "a".repeat(32),
    REFRESH_TOKEN_PEPPER: "b".repeat(32),
    BOOTSTRAP_ADMIN_PASSWORD: "scarline",
    OVERLAY_CONTROL_SECRET: "c".repeat(32),
    UNRELATED_PROCESS_VALUE: "ignored",
  });

  assert.equal(config.project.bootstrap.admin_username, "admin");
  assert.equal(config.secrets.BOOTSTRAP_ADMIN_PASSWORD, "scarline");
  assert.equal("UNRELATED_PROCESS_VALUE" in config.secrets, false);
});

test("hashes the bootstrap password without storing the plaintext", async () => {
  const passwordHash = await hashPassword("scarline");
  assert.match(passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(passwordHash.includes("scarline"), false);
});

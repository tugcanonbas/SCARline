import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";

import type { Pool } from "pg";

import { AuthService, type AuthenticatedPrincipal } from "../src/auth/service.js";
import { loadCoreApiConfig } from "../src/config.js";
import { ApiProblem } from "../src/errors.js";
import { registerErrorHandling } from "../src/errors.js";
import { registerRealtimeRoutes } from "../src/routes/realtime.js";
import { overlayRendererCookie } from "../src/auth/overlay-cookie.js";
import type { CoreApiConfig } from "../src/config.js";
import type { RealtimeHub } from "../src/realtime/hub.js";

const userId = "550e8400-e29b-41d4-a716-446655440020";
const authSessionId = "550e8400-e29b-41d4-a716-446655440021";

interface StoredTicket {
  readonly authSessionId: string;
  expiresAt: Date;
  consumed: boolean;
}

interface StoredOverlayCredential {
  readonly kind: "bootstrap" | "websocket_ticket";
  expiresAt: Date;
  consumed: boolean;
}

class TicketPool {
  readonly tickets = new Map<string, StoredTicket>();
  readonly overlayCredentials = new Map<string, StoredOverlayCredential>();
  revoked = false;

  async query(text: string, values: unknown[] = []) {
    if (text.includes("INSERT INTO auth_websocket_tickets")) {
      this.tickets.set(String(values[0]), {
        authSessionId: String(values[1]),
        expiresAt: values[2] as Date,
        consumed: false,
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO overlay_credentials")) {
      this.overlayCredentials.set(String(values[0]), {
        kind: values[1] as StoredOverlayCredential["kind"],
        expiresAt: values[2] as Date,
        consumed: false,
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM overlay_credentials")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("UPDATE overlay_credentials SET consumed_at")) {
      const credential = this.overlayCredentials.get(String(values[0]));
      if (
        credential === undefined ||
        credential.kind !== values[1] ||
        credential.consumed ||
        credential.expiresAt.getTime() <= Date.now()
      ) {
        return { rows: [], rowCount: 0 };
      }
      credential.consumed = true;
      return { rows: [{ jti: values[0] }], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM auth_websocket_tickets")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("UPDATE auth_websocket_tickets SET consumed_at")) {
      const ticket = this.tickets.get(String(values[0]));
      if (
        ticket === undefined ||
        ticket.authSessionId !== String(values[1]) ||
        ticket.consumed ||
        ticket.expiresAt.getTime() <= Date.now()
      ) {
        return { rows: [], rowCount: 0 };
      }
      ticket.consumed = true;
      return { rows: [{ jti: values[0] }], rowCount: 1 };
    }
    if (text.includes("FROM auth_sessions s")) {
      if (values[0] !== authSessionId || values[1] !== userId) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: userId,
          username: "researcher",
          display_name: "Researcher",
          is_active: true,
          password_reset_required: false,
          revoked_at: this.revoked ? new Date() : null,
          expires_at: new Date(Date.now() + 86_400_000),
          roles: ["researcher", "operator"],
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  expireTickets(): void {
    for (const ticket of this.tickets.values()) ticket.expiresAt = new Date(0);
  }

  expireOverlayCredentials(): void {
    for (const credential of this.overlayCredentials.values()) credential.expiresAt = new Date(0);
  }
}

async function createAuth(pool: TicketPool): Promise<AuthService> {
  const config = await loadCoreApiConfig(undefined, {
    POSTGRES_PASSWORD: "database-password",
    RABBITMQ_DEFAULT_PASS: "rabbitmq-password",
    JWT_ACCESS_SECRET: "a".repeat(32),
    REFRESH_TOKEN_PEPPER: "b".repeat(32),
    BOOTSTRAP_ADMIN_PASSWORD: "scarline",
    OVERLAY_CONTROL_SECRET: "c".repeat(32),
  });
  return new AuthService(pool as unknown as Pool, config);
}

const principal: AuthenticatedPrincipal = {
  id: userId,
  username: "researcher",
  displayName: "Researcher",
  roles: ["researcher", "operator"],
  authSessionId,
  passwordResetRequired: false,
};

test("issues and consumes a user WebSocket ticket exactly once", async () => {
  const pool = new TicketPool();
  const auth = await createAuth(pool);
  const issuedAt = Date.now();
  const issued = await auth.signUserWebSocketTicket(principal);

  assert.ok(new Date(issued.expiresAt).getTime() > issuedAt);
  assert.ok(new Date(issued.expiresAt).getTime() <= issuedAt + 30_500);
  assert.equal((await auth.verifyUserWebSocketTicket(issued.token)).authSessionId, authSessionId);
  await assert.rejects(
    () => auth.verifyUserWebSocketTicket(issued.token),
    (error) => error instanceof ApiProblem && error.problemCode === "INVALID_WEBSOCKET_TICKET",
  );
});

test("rejects expired tickets and tickets whose authentication session was revoked", async () => {
  const pool = new TicketPool();
  const auth = await createAuth(pool);

  const expired = await auth.signUserWebSocketTicket(principal);
  pool.expireTickets();
  await assert.rejects(
    () => auth.verifyUserWebSocketTicket(expired.token),
    (error) => error instanceof ApiProblem && error.problemCode === "INVALID_WEBSOCKET_TICKET",
  );

  const revoked = await auth.signUserWebSocketTicket(principal);
  pool.revoked = true;
  await assert.rejects(
    () => auth.verifyUserWebSocketTicket(revoked.token),
    (error) => error instanceof ApiProblem && error.problemCode === "AUTH_SESSION_REVOKED",
  );
});

const overlayScope = {
  rendererMode: "browser" as const,
  studyId: "550e8400-e29b-41d4-a716-446655440030",
  sessionId: "550e8400-e29b-41d4-a716-446655440031",
  conditionId: "550e8400-e29b-41d4-a716-446655440032",
  layoutId: "550e8400-e29b-41d4-a716-446655440033",
  instanceId: "550e8400-e29b-41d4-a716-446655440034",
};

test("overlay bootstrap credentials are single-use and expired credentials are rejected", async () => {
  const pool = new TicketPool();
  const auth = await createAuth(pool);
  const issued = await auth.signOverlayBootstrapToken(overlayScope);
  const exchanged = await auth.exchangeOverlayBootstrapToken(issued.token);

  assert.deepEqual(exchanged.scope, overlayScope);
  await assert.rejects(
    () => auth.exchangeOverlayBootstrapToken(issued.token),
    (error) => error instanceof ApiProblem && error.problemCode === "OVERLAY_BOOTSTRAP_REUSED",
  );

  const expired = await auth.signOverlayBootstrapToken(overlayScope);
  pool.expireOverlayCredentials();
  await assert.rejects(
    () => auth.exchangeOverlayBootstrapToken(expired.token),
    (error) => error instanceof ApiProblem && error.problemCode === "OVERLAY_BOOTSTRAP_REUSED",
  );
});

test("overlay WebSocket tickets are single-use and expired tickets are rejected", async () => {
  const pool = new TicketPool();
  const auth = await createAuth(pool);
  const issued = await auth.signOverlayWebSocketTicket(overlayScope);

  assert.deepEqual(await auth.verifyOverlayWebSocketTicket(issued.token), overlayScope);
  await assert.rejects(
    () => auth.verifyOverlayWebSocketTicket(issued.token),
    (error) => error instanceof ApiProblem && error.problemCode === "INVALID_OVERLAY_TICKET",
  );

  const expired = await auth.signOverlayWebSocketTicket(overlayScope);
  pool.expireOverlayCredentials();
  await assert.rejects(
    () => auth.verifyOverlayWebSocketTicket(expired.token),
    (error) => error instanceof ApiProblem && error.problemCode === "INVALID_OVERLAY_TICKET",
  );
});

test("renderer cookies support HTTP loopback while keeping remote and HTTPS credentials secure", () => {
  const rendererId = "550e8400-e29b-41d4-a716-446655440040";
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const cookie = overlayRendererCookie({ protocol: "http", hostname }, rendererId);
    assert.equal(cookie.options.secure, false);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, "strict");
    assert.equal(cookie.options.path, `/api/v1/overlay/renderers/${rendererId}`);
    assert.doesNotMatch(cookie.name, /^__Host-|^__Secure-/);
  }
  for (const request of [{ protocol: "https" as const, hostname: "localhost" }, { protocol: "http" as const, hostname: "lab.example.org" }]) {
    const cookie = overlayRendererCookie(request, rendererId);
    assert.equal(cookie.options.secure, true);
    assert.match(cookie.name, /^__Secure-/);
  }
});

test("independent popup launches keep their scopes and reject missing or mismatched cookies", async (context) => {
  const pool = new TicketPool();
  const auth = await createAuth(pool);
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(websocket);
  await registerRealtimeRoutes(app, pool as unknown as Pool, auth, {} as CoreApiConfig, {} as RealtimeHub);
  context.after(() => app.close());

  const scopes = [
    { ...overlayScope, sessionId: null, instanceId: null },
    { ...overlayScope, sessionId: null },
  ];
  const launches = [];
  for (const scope of scopes) {
    const grant = await auth.signOverlayBootstrapToken(scope);
    const bootstrap = await app.inject({
      method: "POST", url: "/api/v1/overlay/bootstrap",
      headers: { host: "localhost:8088", authorization: `Bearer ${grant.token}` },
      payload: { scoped: true },
    });
    assert.equal(bootstrap.statusCode, 200, bootstrap.body);
    const { rendererId } = bootstrap.json().data;
    const cookie = bootstrap.cookies[0]!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, undefined);
    assert.equal(cookie.path, `/api/v1/overlay/renderers/${rendererId}`);
    assert.equal(bootstrap.body.includes(cookie.value), false);
    launches.push({ rendererId, cookie: `${cookie.name}=${cookie.value}`, scope });
  }
  assert.notEqual(launches[0]!.rendererId, launches[1]!.rendererId);
  for (const launch of launches) {
    const url = `/api/v1/overlay/renderers/${launch.rendererId}/websocket-ticket`;
    const ticket = await app.inject({ method: "POST", url, headers: { host: "localhost:8088", cookie: launch.cookie }, payload: {} });
    assert.equal(ticket.statusCode, 200, ticket.body);
    assert.deepEqual(await auth.verifyOverlayWebSocketTicket(ticket.json().data.token), launch.scope);
    const missing = await app.inject({ method: "POST", url, payload: {} });
    assert.equal(missing.statusCode, 401);
    const other = launches.find((entry) => entry !== launch)!;
    const mismatched = await app.inject({ method: "POST", url, headers: { host: "localhost:8088", cookie: other.cookie }, payload: {} });
    assert.equal(mismatched.statusCode, 401);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AuthService } from "../src/auth/service.js";
import type { CoreApiConfig } from "../src/config.js";
import { registerRealtimeRoutes } from "../src/routes/realtime.js";
import { registerErrorHandling } from "../src/errors.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import { InteractionDatabase, ids } from "./fixtures/widget-interactions.js";

test("widget diagnostics enforce study access and return current source status without sample arrays", async () => {
  const db = new InteractionDatabase();
  db.widgets[0]!.widget_key = "hr";
  db.widgets[0]!.metadata = JSON.parse(readFileSync(new URL("../../../widgets/components/hr/widget.json", import.meta.url), "utf8"));
  const original = db.query.bind(db);
  db.query = async (sql, values) => {
    if (sql === "SELECT study_id FROM sessions WHERE id=$1") return { rows: [{ study_id: ids.study }], rowCount: 1 };
    if (sql.includes("FROM study_users")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM layouts l JOIN session_conditions")) return { rows: [{ id: ids.layout, condition_id: ids.condition }], rowCount: 1 };
    return original(sql, values);
  };
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app); await app.register(websocket);
  const hub = new RealtimeHub(db.pool, app.log);
  const auth = { authenticate: async (token: string) => ({ id: ids.study, roles: [token], passwordResetRequired: false }) } as unknown as AuthService;
  await registerRealtimeRoutes(app, db.pool, auth, {} as CoreApiConfig, hub);
  try {
    const url = `/api/v1/sessions/${ids.session}/widgets/data`;
    assert.equal((await app.inject({ url })).statusCode, 400); // Required authorization header schema.
    assert.equal((await app.inject({ url, headers: { authorization: "Bearer observer" } })).statusCode, 403);
    hub.broadcast("session.telemetry", { payload: { heartRateBpm: 75 } }, ids.study, ids.session);
    const response = await app.inject({ url, headers: { authorization: "Bearer admin" } });
    assert.equal(response.statusCode, 200);
    const reading = response.json().data[0].bindings["vitals.heart_rate"];
    assert.equal(reading.value, 75);
    assert.equal(reading.source, "live");
    assert.equal(reading.status, "receiving");
    assert.equal(typeof reading.timestamp, "number");
    assert.equal(reading.history, undefined);
  } finally { await app.close(); }
});

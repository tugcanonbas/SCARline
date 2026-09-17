import { request as httpRequest } from "node:http";
import { URL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { AuthHeadersSchema, EmptyObjectSchema, success } from "./common.js";

async function callProcessManagerTarget(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const encoded = method === "POST" ? JSON.stringify(body) : "";

  return new Promise((resolve, reject) => {
    const requestOptions = socketPath.startsWith("http://")
      ? (() => {
          const target = new URL(path, socketPath.endsWith("/") ? socketPath : `${socketPath}/`);
          return {
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method,
            headers: method === "POST"
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(encoded),
                }
              : undefined,
          };
        })()
      : {
          socketPath,
          path,
          method,
          headers: method === "POST"
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(encoded),
              }
            : undefined,
        };

    const req = httpRequest(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload: Record<string, unknown> = {};
        try {
          payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        } catch {
          payload = { raw };
        }
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(String(payload["error"] ?? `Process Manager returned ${response.statusCode}`)));
          return;
        }
        resolve(payload);
      });
    });

    req.on("error", reject);
    if (method === "POST") req.write(encoded);
    req.end();
  });
}

async function callProcessManager(
  socketPath: string,
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const candidates = [socketPath];
  if (!socketPath.startsWith("http://") && socketPath.includes("/host-tmp/")) {
    candidates.push("http://host.docker.internal:4098");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await callProcessManagerTarget(candidate, method, path, body);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Process Manager unavailable");
}

const CarlaActionParamsSchema = z.object({
  action: z.enum(["start", "stop", "restart"]),
}).strict();

const TestConnectionBodySchema = z.object({
  host: z.string().default("host.docker.internal"),
  port: z.number().int().positive().default(2000),
}).strict().optional();

const SystemConfigSchema = z.object({
  carlaServerPath: z.string().nullable().optional(),
  dataDirectory: z.string().optional(),
  platformPort: z.number().optional(),
  carlaServerPort: z.number().optional(),
  transparentOverlayEnabled: z.boolean().optional(),
}).passthrough();

export async function registerSystemRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  pmSocketPath: string = process.env["PM_SOCKET_PATH"] ?? "/host-tmp/scarline.sock",
): Promise<void> {
  const adminGuards = [authenticate(auth), requirePasswordReady, requireAnyRole("admin")];

  app.get("/api/v1/system/configuration", {
    preHandler: adminGuards,
    schema: { headers: AuthHeadersSchema, querystring: EmptyObjectSchema },
  }, async () => {
    const result = await pool.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM system_configuration WHERE key = 'system_settings'",
    );
    const row = result.rows[0];
    const settings = (row?.value as Record<string, unknown> | undefined) ?? {};
    return success({
      carlaServerPath: settings["carlaServerPath"] ?? null,
      dataDirectory: settings["dataDirectory"] ?? ".scarline-runtime",
      platformPort: Number(settings["platformPort"] ?? 8088),
      carlaServerPort: Number(settings["carlaServerPort"] ?? 2000),
      transparentOverlayEnabled: Boolean(settings["transparentOverlayEnabled"] ?? true),
      ...settings,
    });
  });

  app.put("/api/v1/system/configuration", {
    preHandler: adminGuards,
    schema: { headers: AuthHeadersSchema, querystring: EmptyObjectSchema, body: SystemConfigSchema },
  }, async (request) => {
    const body = SystemConfigSchema.parse(request.body);
    await pool.query(
      `INSERT INTO system_configuration (key, value)
       VALUES ('system_settings', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(body)],
    );
    return success(body);
  });

  app.post("/api/v1/system/carla/:action", {
    preHandler: adminGuards,
    schema: {
      params: CarlaActionParamsSchema,
      headers: AuthHeadersSchema,
    },
  }, async (request) => {
    const { action } = CarlaActionParamsSchema.parse(request.params);
    const body = (request.body as Record<string, unknown>) ?? {};
    try {
      const res = await callProcessManager(pmSocketPath, "POST", `/carla/${action}`, body);
      return success(res);
    } catch (error) {
      throw new ApiProblem(503, "PROCESS_MANAGER_UNAVAILABLE", error instanceof Error ? error.message : "Process Manager unavailable");
    }
  });

  app.post("/api/v1/carla/test-connection", {
    preHandler: adminGuards,
    schema: {
      headers: AuthHeadersSchema,
    },
  }, async (request) => {
    const body = TestConnectionBodySchema.parse(request.body) ?? { host: "host.docker.internal", port: 2000 };
    try {
      const pmStatus = await callProcessManager(pmSocketPath, "GET", "/carla/status");
      return success({
        reachable: pmStatus["status"] === "running",
        host: body.host,
        port: body.port,
        processManager: pmStatus,
      });
    } catch (error) {
      return success({
        reachable: false,
        host: body.host,
        port: body.port,
        message: error instanceof Error ? error.message : "Process Manager unavailable",
      });
    }
  });

  app.post("/api/v1/system/overlay/reload", {
    preHandler: adminGuards,
    schema: {
      headers: AuthHeadersSchema,
    },
  }, async () => {
    try {
      const res = await callProcessManager(pmSocketPath, "POST", "/overlay/reload");
      return success(res);
    } catch (error) {
      throw new ApiProblem(503, "PROCESS_MANAGER_UNAVAILABLE", error instanceof Error ? error.message : "Process Manager unavailable");
    }
  });
}

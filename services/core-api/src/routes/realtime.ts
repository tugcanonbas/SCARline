import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  OVERLAY_RENDER_COOKIE_NAME,
  OVERLAY_RENDER_COOKIE_OPTIONS,
  OverlayControlMessageSchema,
  OverlayDisplaySchema,
  OverlayHostIdSchema,
  OverlayRendererModeSchema,
  OverlayRuntimeScopeSchema,
  UserWebSocketTicketHeadersSchema,
  WebSocketAuthHeadersSchema,
  WidgetRuntimeCommandSchema,
} from "@scarline/contracts";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { CoreApiConfig } from "../config.js";
import { ApiProblem } from "../errors.js";
import { loadOverlayRuntimeSnapshot, requireLiveBrowserSessionScope, resolveOverlayScope } from "../overlay/runtime.js";
import {
  applyManualWidgetRuntimeCommand,
  studyIdForSession,
} from "../overlay/runtime-control.js";
import { createEnvelope, enqueueMessage } from "../infrastructure/outbox.js";
import { OverlayCommandError, type RealtimeHub } from "../realtime/hub.js";
import { AuthHeadersSchema, EmptyObjectSchema, UuidParamsSchema, success } from "./common.js";
import { ensureStudyAccess } from "./studies.js";

const OverlayTokenHeadersSchema = z.object({ "x-overlay-control-secret": z.string().min(1) }).passthrough();
const BootstrapHeadersSchema = z.object({ authorization: z.string().regex(/^Bearer\s+\S+$/) }).passthrough();
const CookieHeadersSchema = z.object({ cookie: z.string().optional() }).passthrough();
const RenderGrantSchema = z.object({
  rendererMode: OverlayRendererModeSchema,
  layoutId: z.string().uuid(),
  instanceId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
}).strict();
const InteractionSchema = z.object({
  instanceId: z.string().uuid(),
  action: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();
const OverlayHostSelectionSchema = z.object({
  hostId: OverlayHostIdSchema,
}).strict();
const SystemStatusSchema = z.object({
  bootstrapCompleted: z.boolean(),
  configuration: z.object({
    environment: z.string(),
    platformPort: z.number().int(),
    runtimeDirectory: z.string(),
    simulatorDefault: z.string(),
    simulatorAutostart: z.boolean(),
    carlaConfigured: z.boolean(),
    carlaPort: z.number().int(),
    adminPanelPort: z.number().int(),
    overlayWebOrigin: z.string(),
    desktopOverlayEnabled: z.boolean(),
    ioClientEnabled: z.boolean(),
    ioClientRuntime: z.string(),
    loggingLevel: z.string(),
    configurationOwner: z.literal("config.yml"),
    processOwner: z.literal("SCARline CLI"),
  }).strict(),
  components: z.array(z.record(z.string(), z.unknown())),
  overlay: z.record(z.string(), z.unknown()),
}).strict();

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  config: CoreApiConfig,
  hub: RealtimeHub,
): Promise<void> {
  app.get("/ws", {
    websocket: true,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: UserWebSocketTicketHeadersSchema },
    preValidation: async (request) => authenticateSocketRequest(request, auth),
  }, (socket, request) => hub.attachUser(socket, request.principal!));

  app.post("/api/v1/overlay/token", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: OverlayTokenHeadersSchema, body: EmptyObjectSchema },
  }, async (request) => {
    const headers = OverlayTokenHeadersSchema.parse(request.headers);
    if (!safeEqual(headers["x-overlay-control-secret"], config.secrets.OVERLAY_CONTROL_SECRET)) {
      throw new ApiProblem(401, "INVALID_OVERLAY_SECRET", "Invalid overlay control secret.");
    }
    return success(await auth.signOverlayToken());
  });

  app.get("/overlay-control", {
    websocket: true,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: WebSocketAuthHeadersSchema },
    preValidation: async (request) => {
      const token = bearerFromHeaders(request, "scarline.overlay-control.");
      if (token === undefined) throw new ApiProblem(401, "AUTHENTICATION_REQUIRED", "Overlay authentication required.");
      await auth.verifyOverlayToken(token);
    },
  }, (socket) => hub.attachOverlay(socket));

  app.get("/overlay-runtime", {
    websocket: true,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: WebSocketAuthHeadersSchema },
    preValidation: async (request) => {
      const token = bearerFromHeaders(request, "scarline.overlay-ticket.");
      if (token === undefined) throw new ApiProblem(401, "AUTHENTICATION_REQUIRED", "Overlay ticket required.");
      (request as FastifyRequest & { overlayScope?: unknown }).overlayScope = await auth.verifyOverlayWebSocketTicket(token);
    },
  }, (socket, request) => {
    const scope = OverlayRuntimeScopeSchema.parse((request as FastifyRequest & { overlayScope?: unknown }).overlayScope);
    void hub.attachRenderer(socket, scope).catch((error) => {
      request.log.warn({ err: error, scope }, "Overlay renderer registration failed");
      socket.close(1011, "Overlay renderer registration failed");
    });
  });

  const readers = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator", "observer")];
  const controllers = [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher", "operator")];
  const administrators = [authenticate(auth), requirePasswordReady, requireAnyRole("admin")];

  app.get("/api/v1/overlay/status", {
    preHandler: readers,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async () => success({ ...hub.overlayStatus, rendererConnected: hub.isOverlayConnected }));

  app.get("/api/v1/components/status", {
    preHandler: readers,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async () => success(hub.componentStatus));

  app.get("/api/v1/system/status", {
    preHandler: administrators,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async () => {
    const bootstrap = await pool.query<{ completed: boolean }>(
      "SELECT COALESCE((SELECT value='true'::jsonb FROM system_configuration WHERE key='bootstrap_completed'),FALSE) AS completed",
    );
    return success(SystemStatusSchema.parse({
      bootstrapCompleted: bootstrap.rows[0]?.completed ?? false,
      configuration: {
        environment: config.project.platform.environment,
        platformPort: config.project.platform.port,
        runtimeDirectory: config.project.platform.runtime_directory,
        simulatorDefault: config.project.simulator.default,
        simulatorAutostart: config.project.simulator.autostart,
        carlaConfigured: config.project.simulator.carla.executable !== null,
        carlaPort: config.project.simulator.carla.port,
        adminPanelPort: config.project.services.admin_panel.port,
        overlayWebOrigin: config.project.services.overlay_web.public_origin,
        desktopOverlayEnabled: config.project.services.desktop_overlay.enabled,
        ioClientEnabled: config.project.services.io_client.enabled,
        ioClientRuntime: config.project.services.io_client.runtime,
        loggingLevel: config.project.logging.level,
        configurationOwner: "config.yml",
        processOwner: "SCARline CLI",
      },
      components: hub.componentStatus,
      overlay: hub.overlayStatus,
    }));
  });

  app.post("/api/v1/overlay/selection", {
    preHandler: controllers,
    schema: {
      params: EmptyObjectSchema,
      querystring: EmptyObjectSchema,
      headers: AuthHeadersSchema,
      body: OverlayHostSelectionSchema,
    },
  }, async (request) => {
    const { hostId } = OverlayHostSelectionSchema.parse(request.body);
    try {
      hub.selectOverlayHost(hostId);
    } catch (error) {
      throw overlayCommandProblem(error);
    }
    return success({ hostId, selected: true });
  });

  app.post("/api/v1/overlay/render-grants", {
    preHandler: controllers,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: RenderGrantSchema },
  }, async (request) => {
    const body = RenderGrantSchema.parse(request.body);
    const scope = await resolveOverlayScope(pool, body);
    await ensureStudyAccess(request, pool, scope.studyId);
    if (scope.rendererMode === "browser") await requireLiveBrowserSessionScope(pool, scope);
    const credential = await auth.signOverlayBootstrapToken(scope);
    const route = scope.instanceId === null ? `/launcher/${scope.layoutId}` : `/widget/${scope.instanceId}`;
    return success({
      ...credential,
      scope,
      launchUrl: `${config.project.services.overlay_web.public_origin}${route}#bootstrap=${encodeURIComponent(credential.token)}`,
    });
  });

  app.post("/api/v1/overlay/bootstrap", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: BootstrapHeadersSchema, body: EmptyObjectSchema },
  }, async (request, reply) => {
    const token = BootstrapHeadersSchema.parse(request.headers).authorization.slice(7);
    const session = await auth.exchangeOverlayBootstrapToken(token);
    reply.setCookie(OVERLAY_RENDER_COOKIE_NAME, session.token, {
      ...OVERLAY_RENDER_COOKIE_OPTIONS,
      expires: new Date(session.expiresAt),
    });
    return success({ expiresAt: session.expiresAt, scope: session.scope });
  });

  app.get("/api/v1/overlay/runtime", {
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: CookieHeadersSchema },
  }, async (request) => success(await loadOverlayRuntimeSnapshot(
    pool,
    await rendererScopeFromCookie(request, auth),
    selectedOverlayDisplays(hub),
  )));

  app.post("/api/v1/overlay/websocket-ticket", {
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: CookieHeadersSchema, body: EmptyObjectSchema },
  }, async (request) => success(await auth.signOverlayWebSocketTicket(await rendererScopeFromCookie(request, auth))));

  app.post("/api/v1/overlay/interactions", {
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: CookieHeadersSchema, body: InteractionSchema },
  }, async (request, reply) => {
    const scope = await rendererScopeFromCookie(request, auth);
    const body = InteractionSchema.parse(request.body);
    const snapshot = await loadOverlayRuntimeSnapshot(pool, scope);
    const widget = snapshot.widgets.find((entry) => entry.instanceId === body.instanceId);
    if (widget === undefined) throw new ApiProblem(403, "WIDGET_OUT_OF_SCOPE", "Widget instance is outside this overlay scope.");
    const actions = Array.isArray(widget.metadata.triggers)
      ? widget.metadata.triggers.map((value) => (value as Record<string, unknown>).action)
      : [];
    if (!actions.includes(body.action)) throw new ApiProblem(400, "UNDECLARED_WIDGET_ACTION", "Widget action is not declared in metadata.");
    const interaction = {
      instanceId: body.instanceId,
      widgetId: widget.widgetId,
      widgetKey: widget.widgetKey,
      action: body.action,
      payload: body.payload,
      source: "overlay-widget",
    };
    if (scope.sessionId !== null) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await enqueueMessage(client, createEnvelope({
          routingKey: `events.${scope.studyId}.${scope.sessionId}.widget.interaction`,
          studyId: scope.studyId,
          sessionId: scope.sessionId,
          payload: interaction,
        }));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    hub.broadcast("widget.updates", {
      ...interaction,
    }, scope.studyId, scope.sessionId);
    return reply.status(202).send(success({ accepted: true }));
  });

  app.post("/api/v1/sessions/:id/widgets/trigger", {
    preHandler: controllers,
    schema: {
      params: UuidParamsSchema,
      querystring: EmptyObjectSchema,
      headers: AuthHeadersSchema,
      body: WidgetRuntimeCommandSchema,
    },
  }, async (request, reply) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const command = WidgetRuntimeCommandSchema.parse(request.body);
    await ensureStudyAccess(request, pool, await studyIdForSession(pool, id));
    const update = await applyManualWidgetRuntimeCommand(pool, id, command, request.principal!.id);
    hub.broadcast("widget.updates", update, update.studyId, update.sessionId);
    return reply.status(202).send(success({ accepted: true, update }));
  });

  app.post("/api/v1/overlay/commands", {
    preHandler: controllers,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: OverlayControlMessageSchema },
  }, async (request, reply) => {
    const requested = OverlayControlMessageSchema.parse(request.body);
    if (requested.type === "overlay.window.open" && requested.window.windowMode !== "transparent_electron") {
      throw new ApiProblem(400, "INVALID_DESKTOP_WINDOW_MODE", "Desktop overlay commands require transparent_electron mode.");
    }
    const commandId = randomUUID();
    const issuedAt = new Date().toISOString();
    let command: Record<string, unknown> = { ...requested, commandId, issuedAt };
    if (requested.type === "overlay.window.open") {
      const scope = await resolveOverlayScope(pool, {
        rendererMode: "desktop",
        layoutId: await layoutIdForInstance(pool, requested.window.instanceId),
        instanceId: requested.window.instanceId,
        sessionId: null,
      });
      await ensureStudyAccess(request, pool, scope.studyId);
      const widget = (await loadOverlayRuntimeSnapshot(pool, scope)).widgets[0];
      if (widget === undefined) throw new ApiProblem(404, "WIDGET_INSTANCE_NOT_FOUND", "Widget instance not found.");
      const credential = await auth.signOverlayBootstrapToken(scope);
      command = {
        commandId,
        hostId: requested.hostId,
        issuedAt,
        type: requested.type,
        window: {
          ...requested.window,
          inputMode: widget.inputMode,
          widgetKey: widget.widgetKey,
          rendererUrl: `${config.project.services.overlay_web.public_origin}/widget/${widget.instanceId}#bootstrap=${encodeURIComponent(credential.token)}`,
        },
      };
    }
    try {
      const result = await hub.sendOverlayCommand(command);
      return reply.status(200).send(success(result));
    } catch (error) {
      throw overlayCommandProblem(error);
    }
  });
}

function selectedOverlayDisplays(hub: RealtimeHub) {
  const status = hub.overlayStatus as { displays?: unknown };
  return OverlayDisplaySchema.array().parse(Array.isArray(status.displays) ? status.displays : []);
}

function overlayCommandProblem(error: unknown): ApiProblem {
  if (!(error instanceof OverlayCommandError)) {
    return new ApiProblem(500, "OVERLAY_COMMAND_FAILED", error instanceof Error ? error.message : "Overlay command failed.");
  }
  const status = error.code === "OVERLAY_COMMAND_TIMEOUT"
    ? 504
    : error.code === "OVERLAY_UNAVAILABLE" || error.code === "OVERLAY_HOST_NOT_CONNECTED" || error.code === "OVERLAY_DISCONNECTED"
      ? 503
      : error.code === "INVALID_OVERLAY_COMMAND"
        ? 400
        : 409;
  return new ApiProblem(status, error.code, error.message);
}

async function rendererScopeFromCookie(request: FastifyRequest, auth: AuthService) {
  const token = request.cookies[OVERLAY_RENDER_COOKIE_NAME];
  if (token === undefined) throw new ApiProblem(401, "OVERLAY_SESSION_REQUIRED", "Overlay renderer session required.");
  return auth.verifyOverlayRenderSession(token);
}

async function layoutIdForInstance(pool: Pool, instanceId: string): Promise<string> {
  const result = await pool.query<{ layout_id: string }>("SELECT layout_id FROM widget_instances WHERE id=$1 AND enabled=TRUE", [instanceId]);
  if (result.rows[0] === undefined) throw new ApiProblem(404, "WIDGET_INSTANCE_NOT_FOUND", "Widget instance not found.");
  return result.rows[0].layout_id;
}

async function authenticateSocketRequest(request: FastifyRequest, auth: AuthService): Promise<void> {
  const token = bearerFromHeaders(request, "scarline.user-ticket.");
  if (token === undefined) throw new ApiProblem(401, "AUTHENTICATION_REQUIRED", "WebSocket ticket required.");
  request.principal = await auth.verifyUserWebSocketTicket(token);
  if (request.principal.passwordResetRequired) throw new ApiProblem(403, "PASSWORD_CHANGE_REQUIRED", "Password change required.");
}

function bearerFromHeaders(request: FastifyRequest, protocolPrefix: string): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((value) => value.trim()) ?? [];
  return protocols.find((value) => value.startsWith(protocolPrefix))?.slice(protocolPrefix.length);
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

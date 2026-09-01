import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import type { CoreApiConfig } from "./config.js";
import { registerErrorHandling } from "./errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerStudyRoutes } from "./routes/studies.js";
import { registerConfigurationRoutes } from "./routes/configuration.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { AuthService } from "./auth/service.js";
import { OutboxPublisher } from "./infrastructure/outbox.js";
import { SessionLifecycleService } from "./sessions/service.js";
import { RealtimeHub } from "./realtime/hub.js";
import { registerRealtimeRoutes } from "./routes/realtime.js";
import { ExportWorker } from "./exports/service.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import path from "node:path";
import { SessionOverlayService } from "./overlay/session-layout.js";
import { WidgetCatalogueService } from "./widgets/catalogue.js";
import { SensorCatalogueService } from "./sensors/catalogue.js";
import { registerSensorRoutes } from "./routes/sensors.js";
import {
  ProductionCoreApiRuntime,
  type CoreApiRuntime,
} from "./runtime.js";

export interface BuildAppOptions {
  readonly config?: CoreApiConfig;
  readonly runtime?: CoreApiRuntime;
  readonly logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    requestIdHeader: "x-request-id",
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(websocket);
  if (options.config !== undefined) {
    await app.register(cors, {
      origin: options.config.project.api.allowed_origins,
      credentials: true,
    });
  }

  const runtime =
    options.runtime ??
    (options.config === undefined
      ? undefined
      : new ProductionCoreApiRuntime(options.config, app.log));
  if (runtime === undefined) {
    throw new Error("buildApp requires either a CoreAPI config or runtime");
  }

  await registerHealthRoutes(app, runtime);
  if (runtime instanceof ProductionCoreApiRuntime) {
    const auth = new AuthService(runtime.pool, runtime.config);
    const realtime = new RealtimeHub(runtime.pool, app.log);
    await registerAuthRoutes(app, auth, runtime.config);
    await registerUserRoutes(
      app,
      runtime.pool,
      auth,
      runtime.config.project.api.pagination_default_limit,
      runtime.config.project.api.pagination_max_limit,
    );
    await registerStudyRoutes(
      app,
      runtime.pool,
      auth,
      realtime,
      runtime.config.project.api.pagination_default_limit,
      runtime.config.project.api.pagination_max_limit,
    );
    const widgetCatalogue = new WidgetCatalogueService(
      runtime.pool,
      path.resolve(
        runtime.config.repositoryRoot,
        runtime.config.project.api.widgets_directory,
      ),
      app.log,
    );
    runtime.registerService(widgetCatalogue);
    const sensorCatalogue = new SensorCatalogueService(
      runtime.pool,
      path.resolve(runtime.config.repositoryRoot, runtime.config.project.api.sensors_directory),
      app.log,
    );
    runtime.registerService(sensorCatalogue);
    await registerConfigurationRoutes(
      app,
      runtime.pool,
      auth,
      widgetCatalogue,
      realtime,
    );
    await registerSensorRoutes(app, auth, sensorCatalogue);
    await registerRealtimeRoutes(app, runtime.pool, auth, runtime.config, realtime);
    await registerDashboardRoute(app, runtime.pool, auth, realtime);
    const sessionOverlays = new SessionOverlayService(
      runtime.pool,
      auth,
      realtime,
      runtime.config.project.services.overlay_web.public_origin,
    );
    const lifecycle = new SessionLifecycleService(
      runtime.pool,
      runtime.rabbit,
      app.log,
      runtime.config.project.api.command_timeout_seconds,
      realtime,
      sessionOverlays,
    );
    runtime.registerService(lifecycle);
    runtime.registerService(new OutboxPublisher(runtime.pool, runtime.rabbit, app.log));
    const exportsDirectory = path.resolve(
      runtime.config.repositoryRoot,
      runtime.config.project.api.exports_directory,
    );
    runtime.registerService(new ExportWorker(runtime.pool, exportsDirectory, app.log, realtime));
    await registerSessionRoutes(
      app,
      runtime.pool,
      auth,
      lifecycle,
      sessionOverlays,
      runtime.config.project.api.pagination_default_limit,
      runtime.config.project.api.pagination_max_limit,
    );
    await registerExportRoutes(app, runtime.pool, auth, exportsDirectory);
    await registerEventRoutes(app, runtime.pool, auth);
    await registerActivityRoutes(app, runtime.pool, auth);
  }
  app.addHook("onReady", async () => runtime.start());
  app.addHook("onClose", async () => runtime.stop());
  return app;
}

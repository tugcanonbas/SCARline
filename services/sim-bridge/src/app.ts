import { timingSafeEqual } from "node:crypto";

import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";

import type { SimBridgeConfig } from "./config.js";
import { SimBridgeController } from "./controller.js";
import {
  SimBridgeRabbitConnection,
  createRabbitUrl,
} from "./rabbitmq.js";

export async function buildApp(
  config: SimBridgeConfig,
  logger: FastifyServerOptions["logger"] = true,
): Promise<FastifyInstance> {
  const app = Fastify({ logger, requestIdHeader: "x-request-id" });
  await app.register(websocket, {
    options: {
      maxPayload: config.project.sim_bridge.maximum_websocket_message_bytes,
    },
  });

  let controller!: SimBridgeController;
  const rabbit = new SimBridgeRabbitConnection(
    createRabbitUrl(
      config.project.rabbitmq.host,
      config.project.rabbitmq.port,
      config.project.rabbitmq.user,
      config.secrets.RABBITMQ_DEFAULT_PASS,
    ),
    app.log,
    (message) => controller.handleCommand(message),
    (message) => controller.handleRealtimeControl(message),
  );
  controller = new SimBridgeController(config, app.log, rabbit);

  app.get("/health", async () => ({
    status: "healthy",
    component: "sim-bridge",
    adapters: controller.adapters,
  }));
  app.get("/ready", async (_request, reply) => {
    if (!controller.isReady) reply.status(503);
    return {
      status: controller.isReady ? "healthy" : "degraded",
      component: "sim-bridge",
      rabbitmq: rabbit.isReady,
      adapters: controller.adapters,
    };
  });
  app.get(config.project.sim_bridge.adapter_path, {
    websocket: true,
    preValidation: async (request, reply) => authenticateAdapter(request, reply, config),
  }, (socket) => controller.attachSocket(socket));

  app.addHook("onReady", async () => controller.start());
  app.addHook("onClose", async () => controller.stop());
  return app;
}

async function authenticateAdapter(
  request: FastifyRequest,
  reply: FastifyReply,
  config: SimBridgeConfig,
): Promise<void> {
  const authorization = request.headers.authorization;
  const actual = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (actual === null || !safeEqual(actual, config.secrets.SIM_BRIDGE_ADAPTER_SECRET)) {
    await reply.status(401).send({
      error: "ADAPTER_AUTHENTICATION_REQUIRED",
      message: "A valid simulator adapter secret is required.",
    });
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

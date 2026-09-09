import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { PlatformHealthSchema } from "@scarline/contracts";

import type { CoreApiRuntime } from "../runtime.js";

const EmptyObjectSchema = z.object({}).strict();
const RequestHeadersSchema = z.object({}).passthrough();

export async function registerHealthRoutes(
  app: FastifyInstance,
  runtime: CoreApiRuntime,
): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: RequestHeadersSchema,
        response: { 200: PlatformHealthSchema },
      },
    },
    async () => runtime.liveness(),
  );

  app.get(
    "/ready",
    {
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: RequestHeadersSchema,
        response: {
          200: PlatformHealthSchema,
          503: PlatformHealthSchema,
        },
      },
    },
    async (_request, reply) => {
      const health = await runtime.readiness();
      return health.status === "healthy"
        ? reply.status(200).send(health)
        : reply.status(503).send(health);
    },
  );
}

import { z } from "zod";

import { IsoDateTimeSchema, JsonObjectSchema } from "./common.js";

export const ComponentIdSchema = z.enum([
  "database",
  "rabbitmq",
  "core-api",
  "sim-bridge",
  "mock-simulator",
  "carla-client",
  "carla-server",
  "io-client",
  "overlay-web",
  "desktop-overlay",
  "admin-panel",
  "docker",
]);

export const ComponentHealthStatusSchema = z.enum([
  "starting",
  "healthy",
  "degraded",
  "unhealthy",
  "stopped",
  "unavailable",
]);

export const ComponentHealthSchema = z
  .object({
    componentId: ComponentIdSchema,
    status: ComponentHealthStatusSchema,
    checkedAt: IsoDateTimeSchema,
    message: z.string().nullable(),
    metadata: JsonObjectSchema,
  })
  .strict();

export const PlatformHealthSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    checkedAt: IsoDateTimeSchema,
    components: z.array(ComponentHealthSchema),
  })
  .strict();

export type ComponentId = z.infer<typeof ComponentIdSchema>;
export type ComponentHealthStatus = z.infer<
  typeof ComponentHealthStatusSchema
>;
export type ComponentHealth = z.infer<typeof ComponentHealthSchema>;
export type PlatformHealth = z.infer<typeof PlatformHealthSchema>;

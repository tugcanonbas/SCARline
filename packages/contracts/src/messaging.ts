import { z } from "zod";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  UuidSchema,
} from "./common.js";

export const RABBITMQ_EXCHANGES = {
  commands: "scarline.commands",
  events: "scarline.events",
  realtime: "scarline.realtime",
  deadLetters: "scarline.dlx",
} as const;

export const CommandRoutingKeySchema = z
  .string()
  .regex(/^commands\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);

export const EventStudyScopeSchema = z.union([
  UuidSchema,
  z.literal("system"),
]);

export const EventSessionScopeSchema = z.union([
  UuidSchema,
  z.literal("global"),
]);

export const EventRoutingKeySchema = z
  .string()
  .regex(
    /^events\.(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|system)\.(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|global)\.[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/i,
  );

export const RoutingKeySchema = z.union([
  CommandRoutingKeySchema,
  EventRoutingKeySchema,
]);

export const MessageProducerSchema = z.enum([
  "core-api",
  "sim-bridge",
  "io-client",
]);

export const MessageSourceSchema = z
  .object({
    component: z.string().regex(/^[a-z][a-z0-9-]*$/),
    instanceId: z.string().min(1).nullable(),
  })
  .strict();

export const MessageMetadataSchema = z
  .object({
    studyId: z.union([UuidSchema, z.null()]),
    sessionId: z.union([UuidSchema, z.null()]),
    correlationId: z.union([UuidSchema, z.null()]),
    source: z.union([MessageSourceSchema, z.null()]),
  })
  .strict();

export const MessageEnvelopeSchema = z
  .object({
    id: UuidSchema,
    timestamp: IsoDateTimeSchema,
    routingKey: RoutingKeySchema,
    producer: MessageProducerSchema,
    payload: JsonObjectSchema,
    metadata: MessageMetadataSchema,
  })
  .strict();

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

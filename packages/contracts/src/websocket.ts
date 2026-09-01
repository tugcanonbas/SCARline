import { z } from "zod";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  UuidSchema,
} from "./common.js";
import { PlatformHealthSchema } from "./health.js";
import { MessageEnvelopeSchema } from "./messaging.js";
import { ExportProgressPayloadSchema } from "./export.js";
import { SensorStatusPayloadSchema } from "./sensor.js";
import { SessionStatusSchema } from "./session.js";

export const LifecycleCommandStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
  "timed_out",
]);

export const SessionLifecycleActionSchema = z.enum([
  "ready",
  "start",
  "pause",
  "resume",
  "advance",
  "complete",
  "abort",
  "fail",
]);

export const CORE_API_WEBSOCKET_PATH = "/ws";
export const SIM_BRIDGE_ADAPTER_WEBSOCKET_PATH = "/adapter";

export const WebSocketChannelSchema = z.enum([
  "session.lifecycle",
  "session.events",
  "session.telemetry",
  "widget.updates",
  "overlay.windows",
  "system.health",
  "sensor.status",
  "export.progress",
]);

export const WebSocketSubscriptionFiltersSchema = z
  .object({
    studyId: UuidSchema.optional(),
    sessionId: UuidSchema.optional(),
  })
  .strict();

const SubscriptionRequestBaseSchema = z.object({
  requestId: UuidSchema,
  channels: z.array(WebSocketChannelSchema).min(1),
  filters: WebSocketSubscriptionFiltersSchema.optional(),
});

export const WebSocketSubscribeMessageSchema = SubscriptionRequestBaseSchema.extend({
  type: z.literal("subscription.subscribe"),
}).strict();

export const WebSocketUnsubscribeMessageSchema = SubscriptionRequestBaseSchema.extend({
  type: z.literal("subscription.unsubscribe"),
}).strict();

export const WebSocketClientMessageSchema = z.discriminatedUnion("type", [
  WebSocketSubscribeMessageSchema,
  WebSocketUnsubscribeMessageSchema,
]);

export const WebSocketSubscriptionAckSchema = z
  .object({
    type: z.literal("subscription.ack"),
    requestId: UuidSchema,
    action: z.enum(["subscribe", "unsubscribe"]),
    channels: z.array(WebSocketChannelSchema),
  })
  .strict();

export const SessionLifecycleWebSocketPayloadSchema = z
  .object({
    studyId: UuidSchema,
    sessionId: UuidSchema,
    previousStatus: SessionStatusSchema.nullable(),
    status: SessionStatusSchema,
    commandId: UuidSchema.nullable(),
    commandAction: SessionLifecycleActionSchema.nullable(),
    commandStatus: LifecycleCommandStatusSchema.nullable(),
    commandError: z.string().nullable(),
    activeConditionId: UuidSchema.nullable(),
    activeConditionName: z.string().nullable(),
    activeConditionSequence: z.number().int().nonnegative().nullable(),
    conditionCount: z.number().int().nonnegative(),
    remainingConditionCount: z.number().int().nonnegative(),
  })
  .strict();

const createDataMessageSchema = <
  TChannel extends z.ZodLiteral<string>,
  TData extends z.ZodType,
>(channel: TChannel, data: TData) =>
  z
    .object({
      type: z.literal("data"),
      channel,
      timestamp: IsoDateTimeSchema,
      data,
    })
    .strict();

export const WebSocketDataMessageSchema = z.discriminatedUnion("channel", [
  createDataMessageSchema(
    z.literal("session.lifecycle"),
    SessionLifecycleWebSocketPayloadSchema,
  ),
  createDataMessageSchema(z.literal("session.events"), MessageEnvelopeSchema),
  createDataMessageSchema(z.literal("session.telemetry"), JsonObjectSchema),
  createDataMessageSchema(z.literal("widget.updates"), JsonObjectSchema),
  createDataMessageSchema(z.literal("overlay.windows"), JsonObjectSchema),
  createDataMessageSchema(z.literal("system.health"), PlatformHealthSchema),
  createDataMessageSchema(z.literal("sensor.status"), SensorStatusPayloadSchema),
  createDataMessageSchema(
    z.literal("export.progress"),
    ExportProgressPayloadSchema,
  ),
]);

export const WebSocketErrorMessageSchema = z
  .object({
    type: z.literal("error"),
    requestId: UuidSchema.nullable(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().min(1),
  })
  .strict();

export const WebSocketServerMessageSchema = z.discriminatedUnion("type", [
  WebSocketSubscriptionAckSchema,
  WebSocketDataMessageSchema,
  WebSocketErrorMessageSchema,
]);

export type WebSocketChannel = z.infer<typeof WebSocketChannelSchema>;
export type WebSocketClientMessage = z.infer<
  typeof WebSocketClientMessageSchema
>;
export type WebSocketServerMessage = z.infer<
  typeof WebSocketServerMessageSchema
>;

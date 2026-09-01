import { z } from "zod";

import { IsoDateTimeSchema, JsonObjectSchema } from "./common.js";

export const SessionEventAggregateQuerySchema = z.object({
  studyId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
  modality: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().min(1).optional(),
}).strict();

export const SessionEventLogItemSchema = z.object({
  id: z.string().regex(/^\d+$/),
  messageId: z.string().uuid().nullable(),
  studyId: z.string().uuid(),
  studyName: z.string(),
  studyStatus: z.string(),
  sessionId: z.string().uuid(),
  sessionName: z.string().nullable(),
  sessionConditionId: z.string().uuid().nullable(),
  timestamp: IsoDateTimeSchema,
  eventType: z.string(),
  modality: z.string().nullable(),
  sourceType: z.string(),
  sourceId: z.string().uuid().nullable(),
  sourceKey: z.string().nullable(),
  routingKey: z.string().nullable(),
  schemaVersion: z.string(),
  payload: JsonObjectSchema,
}).strict();

export const SessionEventAggregateSchema = z.object({
  activeStudyCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  storedPayloadBytes: z.number().int().nonnegative(),
}).strict();

export const SessionEventAggregateResponseSchema = z.object({
  items: z.array(SessionEventLogItemSchema),
  nextCursor: z.string().nullable(),
  aggregates: SessionEventAggregateSchema,
}).strict();

export type SessionEventAggregateQuery = z.infer<typeof SessionEventAggregateQuerySchema>;
export type SessionEventAggregateResponse = z.infer<typeof SessionEventAggregateResponseSchema>;

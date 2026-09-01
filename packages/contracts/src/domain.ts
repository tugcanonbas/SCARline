import { z } from "zod";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  UuidSchema,
} from "./common.js";
import { SessionStatusSchema } from "./session.js";

export const RoleSchema = z.enum(["admin", "researcher", "operator", "observer"]);

export const StudyStatusSchema = z.enum([
  "draft",
  "configured",
  "ready",
  "running",
  "completed",
  "archived",
]);

export const SessionConditionStatusSchema = z.enum([
  "pending",
  "active",
  "paused",
  "completed",
  "skipped",
  "aborted",
  "failed",
]);

export const StudyDataPolicySchema = z
  .object({
    persistence: z
      .object({
        mode: z.enum(["all", "sampled"]),
        sampleEveryN: z.number().int().positive(),
        retentionDays: z.number().int().positive().nullable(),
      })
      .strict(),
    realtime: z
      .object({
        maximumHz: z.number().positive().nullable(),
      })
      .strict(),
  })
  .strict();

export const DEFAULT_STUDY_DATA_POLICY = {
  persistence: {
    mode: "all",
    sampleEveryN: 1,
    retentionDays: null,
  },
  realtime: { maximumHz: null },
} as const;

export const UserSchema = z
  .object({
    id: UuidSchema,
    username: z.string().min(1).max(100),
    displayName: z.string().min(1).max(200),
    email: z.string().email().nullable(),
    institution: z.string().max(300).nullable(),
    isActive: z.boolean(),
    disabledReason: z.string().nullable(),
    lastLoginAt: IsoDateTimeSchema.nullable(),
    passwordResetRequired: z.boolean(),
    roles: z.array(RoleSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const StudySchema = z
  .object({
    id: UuidSchema,
    name: z.string().min(1).max(300),
    description: z.string().nullable(),
    version: z.string().min(1).max(50),
    status: StudyStatusSchema,
    createdBy: UuidSchema.nullable(),
    metadata: JsonObjectSchema,
    dataPolicy: StudyDataPolicySchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ParticipantSchema = z
  .object({
    id: UuidSchema,
    studyId: UuidSchema,
    participantCode: z.string().min(1).max(50),
    demographicData: JsonObjectSchema,
    notes: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ConditionSchema = z
  .object({
    id: UuidSchema,
    studyId: UuidSchema,
    name: z.string().min(1).max(200),
    description: z.string().nullable(),
    order: z.number().int().nonnegative(),
    metadata: JsonObjectSchema,
    archivedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionSchema = z
  .object({
    id: UuidSchema,
    studyId: UuidSchema,
    participantId: UuidSchema,
    name: z.string().max(200).nullable(),
    status: SessionStatusSchema,
    startedByUserId: UuidSchema.nullable(),
    startedAt: IsoDateTimeSchema.nullable(),
    pausedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    runtimeMetadata: JsonObjectSchema,
    notes: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const SessionConditionSchema = z
  .object({
    id: UuidSchema,
    sessionId: UuidSchema,
    studyId: UuidSchema,
    conditionId: UuidSchema,
    sequence: z.number().int().nonnegative(),
    status: SessionConditionStatusSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    configurationSnapshot: JsonObjectSchema,
    runtimeMetadata: JsonObjectSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type Role = z.infer<typeof RoleSchema>;
export type StudyStatus = z.infer<typeof StudyStatusSchema>;
export type SessionConditionStatus = z.infer<
  typeof SessionConditionStatusSchema
>;
export type StudyDataPolicy = z.infer<typeof StudyDataPolicySchema>;
export type User = z.infer<typeof UserSchema>;
export type Study = z.infer<typeof StudySchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type SessionCondition = z.infer<typeof SessionConditionSchema>;

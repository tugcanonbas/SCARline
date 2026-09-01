import { z } from "zod";

import { IsoDateTimeSchema, JsonObjectSchema, UuidSchema } from "./common.js";

export const IoDisconnectPolicySchema = z.enum(["fail", "continue"]);

export const IoSensorChannelSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(200),
  modality: z.string().trim().min(1).max(50),
  unit: z.string().trim().max(50).nullable(),
  sampleRate: z.number().positive().max(10_000),
  configurationSchema: JsonObjectSchema,
}).strict();

export const IoDriverManifestSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(50),
  deviceType: z.string().trim().min(1).max(50),
  platforms: z.array(z.enum(["linux", "darwin", "win32"])).min(1),
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.-]*$/)),
  configurationSchema: JsonObjectSchema,
  channels: z.array(IoSensorChannelSchema).min(1),
  optionalDependency: z.string().trim().min(1).nullable(),
  mock: z.boolean(),
}).strict();

export const IoConfiguredSensorSchema = z.object({
  sensorId: UuidSchema,
  key: z.string().min(1),
  modality: z.string().nullable(),
  unit: z.string().nullable(),
  enabled: z.boolean(),
  sampleRate: z.number().positive().max(10_000),
  configuration: JsonObjectSchema,
}).strict();

export const IoConfiguredDeviceSchema = z.object({
  assignmentId: UuidSchema,
  deviceId: UuidSchema,
  sourceKey: z.string().min(1),
  driverKey: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  required: z.boolean(),
  onDisconnect: IoDisconnectPolicySchema,
  configuration: JsonObjectSchema,
  sensors: z.array(IoConfiguredSensorSchema),
}).strict();

export const IoSessionConfigurationSchema = z.object({
  studyId: UuidSchema,
  sessionId: UuidSchema,
  sessionConditionId: UuidSchema,
  sequence: z.number().int().nonnegative(),
  devices: z.array(IoConfiguredDeviceSchema),
  recording: z.object({
    enabled: z.boolean(),
    directory: z.string().min(1).nullable(),
  }).strict(),
}).strict();

const IoLifecycleBaseSchema = z.object({
  commandId: UuidSchema,
  sessionId: UuidSchema,
  deadlineAt: IsoDateTimeSchema,
}).strict();

export const IoLifecycleCommandSchema = z.union([
  IoLifecycleBaseSchema.extend({
    action: z.enum(["start", "advance"]),
    configuration: IoSessionConfigurationSchema,
  }).strict(),
  IoLifecycleBaseSchema.extend({
    action: z.enum(["pause", "resume", "complete", "abort"]),
  }).strict(),
]);

export const IoCommandAcknowledgementSchema = z.object({
  commandId: UuidSchema,
  component: z.literal("io-client"),
  status: z.enum(["completed", "failed"]),
  error: z.string().max(2_000).nullable(),
  warning: z.string().max(2_000).nullable(),
}).strict();

export const IoDeviceDiscoveryPayloadSchema = z.object({
  sourceKey: z.string().min(1).max(200),
  driverKey: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  metadata: JsonObjectSchema,
  channels: z.array(IoSensorChannelSchema),
}).strict();

export const IoSensorBatchPayloadSchema = z.object({
  sessionConditionId: UuidSchema,
  deviceId: UuidSchema,
  sensorId: UuidSchema,
  sourceKey: z.string().min(1),
  channelKey: z.string().min(1),
  sequenceStart: z.number().int().nonnegative(),
  sampleRate: z.number().positive(),
  sourceTimestamp: IsoDateTimeSchema,
  droppedSamples: z.number().int().nonnegative(),
  samples: z.array(JsonObjectSchema).min(1).max(10_000),
}).strict();

export type IoDriverManifest = z.infer<typeof IoDriverManifestSchema>;
export type IoSessionConfiguration = z.infer<typeof IoSessionConfigurationSchema>;
export type IoLifecycleCommand = z.infer<typeof IoLifecycleCommandSchema>;
export type IoCommandAcknowledgement = z.infer<typeof IoCommandAcknowledgementSchema>;

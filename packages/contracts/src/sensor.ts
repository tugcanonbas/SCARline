import { z } from "zod";

import { IsoDateTimeSchema, JsonObjectSchema } from "./common.js";

export const SensorStatusPayloadSchema = z
  .object({
    driverId: z.string().min(1),
    sensorType: z.string().min(1),
    connected: z.boolean(),
    sampleRate: z.number().nonnegative(),
    message: z.string().nullable(),
    checkedAt: IsoDateTimeSchema,
    capabilities: z.array(z.string().min(1)),
    configSchema: JsonObjectSchema,
    degraded: z.boolean(),
  })
  .strict();

export const BlinkEventPayloadSchema = z
  .object({
    earLeft: z.number().nullable(),
    earRight: z.number().nullable(),
    earAverage: z.number().nullable(),
    blinkDetected: z.boolean(),
    blinkCount: z.number().int().nonnegative(),
    eyesClosed: z.boolean(),
    connected: z.boolean(),
    mouthAspectRatio: z.number().optional(),
    yawnDetected: z.boolean().optional(),
    headPose: z
      .object({
        pitch: z.number(),
        yaw: z.number(),
        roll: z.number(),
      })
      .strict()
      .optional(),
    gazePoint: z
      .object({ x: z.number(), y: z.number() })
      .strict()
      .optional(),
    eyebrowDistance: z.number().optional(),
  })
  .strict();

export const GestureEventPayloadSchema = z
  .object({
    gestureId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    handedness: z.enum(["left", "right", "unknown"]),
    connected: z.boolean(),
  })
  .strict();

export const EyeTrackerEventPayloadSchema = z
  .object({
    gaze: z
      .object({
        x: z.number().nullable(),
        y: z.number().nullable(),
      })
      .strict(),
    pupilDiameter: z.number().nullable(),
    connected: z.boolean(),
  })
  .strict();

export const HeartRateEventPayloadSchema = z
  .object({
    heartRateBpm: z.number().nullable(),
    rrIntervalMs: z.number().nullable(),
    connected: z.boolean(),
  })
  .strict();

export const EcgEventPayloadSchema = z
  .object({
    ecgSamples: z.array(z.number()).nullable(),
    sampleRate: z.number().nullable(),
    dataLostCount: z.number().int().nonnegative().nullable(),
    connected: z.boolean(),
  })
  .strict();

export type SensorStatusPayload = z.infer<typeof SensorStatusPayloadSchema>;

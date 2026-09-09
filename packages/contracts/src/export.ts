import { z } from "zod";

import { UuidSchema } from "./common.js";

export const ExportJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const ExportProgressPayloadSchema = z
  .object({
    exportJobId: UuidSchema,
    status: ExportJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    artifactPath: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .strict();

export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;
export type ExportProgressPayload = z.infer<
  typeof ExportProgressPayloadSchema
>;

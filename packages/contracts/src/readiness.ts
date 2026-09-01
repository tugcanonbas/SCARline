import { z } from "zod";

import { IsoDateTimeSchema, JsonObjectSchema, UuidSchema } from "./common.js";

export const StudyReadinessCheckKeySchema = z.enum([
  "participants",
  "conditions",
  "simulator",
  "sensors",
  "participant_view",
  "desktop_host",
  "displays",
  "widget_renderer",
  "study_status",
]);

export const StudyReadinessCheckSchema = z
  .object({
    key: StudyReadinessCheckKeySchema,
    status: z.enum(["ready", "not_ready"]),
    blocking: z.boolean(),
    blockingCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
    message: z.string().min(1),
    correctionRoute: z.string().startsWith("/"),
    details: JsonObjectSchema,
  })
  .strict();

export const StudyReadinessSchema = z
  .object({
    studyId: UuidSchema,
    ready: z.boolean(),
    checkedAt: IsoDateTimeSchema,
    checks: z.array(StudyReadinessCheckSchema).length(9),
  })
  .strict();

export type StudyReadinessCheckKey = z.infer<
  typeof StudyReadinessCheckKeySchema
>;
export type StudyReadinessCheck = z.infer<typeof StudyReadinessCheckSchema>;
export type StudyReadiness = z.infer<typeof StudyReadinessSchema>;

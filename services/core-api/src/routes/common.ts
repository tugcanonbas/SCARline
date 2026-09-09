import { z } from "zod";

export const EmptyObjectSchema = z.object({}).strict();
export const PublicHeadersSchema = z.object({}).passthrough();
export const AuthHeadersSchema = z
  .object({ authorization: z.string().regex(/^Bearer\s+\S+$/i) })
  .passthrough();
export const UuidParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const StudyParamsSchema = z.object({ studyId: z.string().uuid() }).strict();
export const StudyEntityParamsSchema = z
  .object({ studyId: z.string().uuid(), id: z.string().uuid() })
  .strict();

export function success<T>(data: T): {
  readonly success: true;
  readonly data: T;
  readonly error: null;
} {
  return { success: true, data, error: null };
}

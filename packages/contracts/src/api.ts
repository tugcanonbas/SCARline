import { z } from "zod";

export const ApiErrorSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()),
    requestId: z.string().min(1),
  })
  .strict();

export const ApiErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    error: ApiErrorSchema,
  })
  .strict();

export function createApiSuccessEnvelopeSchema<T extends z.ZodType>(
  dataSchema: T,
) {
  return z
    .object({
      success: z.literal(true),
      data: dataSchema,
      error: z.null(),
    })
    .strict();
}

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

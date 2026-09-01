import { z } from "zod";

import { JsonObjectSchema } from "./common.js";

const EventPathSchema = z.string().regex(/^[a-zA-Z0-9_.-]+$/);
const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const TriggerExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ operator: z.literal("and"), expressions: z.array(TriggerExpressionSchema).min(1) }).strict(),
    z.object({ operator: z.literal("or"), expressions: z.array(TriggerExpressionSchema).min(1) }).strict(),
    z.object({ operator: z.literal("not"), expression: TriggerExpressionSchema }).strict(),
    z.union([
      z
        .object({
          operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]),
          path: EventPathSchema,
          value: z.union([ScalarSchema, z.array(ScalarSchema)]),
        })
        .strict(),
      z
        .object({
          operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
          path: EventPathSchema,
          valuePath: EventPathSchema,
        })
        .strict(),
    ]),
  ]),
);

export const TriggerActionTypeSchema = z.enum([
  "widget.update",
  "overlay.command",
  "session-condition.advance",
  "simulator.command",
]);

export const TriggerActionConfigSchema = JsonObjectSchema;

export type TriggerActionType = z.infer<typeof TriggerActionTypeSchema>;

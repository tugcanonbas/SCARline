import { z } from "zod";

export const WidgetBindingTypeSchema = z.enum([
  "number",
  "string",
  "boolean",
  "object",
  "array",
]);

export const WidgetBindingSchema = z
  .object({
    key: z.string().min(1),
    type: WidgetBindingTypeSchema,
    label: z.string().min(1).optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    preview: z.unknown().optional(),
    source: z.enum(["live", "study", "presentation"]).optional(),
    staleAfterMs: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    for (const field of ["default", "preview"] as const) {
      const value = binding[field];
      if (value === undefined) continue;
      const valid = binding.type === "array" ? Array.isArray(value)
        : binding.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
          : binding.type === "number" ? typeof value === "number" && Number.isFinite(value)
            : typeof value === binding.type;
      if (!valid) context.addIssue({ code: "custom", path: [field],
        message: `${field} value must match binding type ${binding.type}` });
    }
  });

export const WidgetActionSchema = z
  .object({
    action: z.string().min(1),
    description: z.string().min(1),
    interactionType: z.string().min(1).optional(),
  })
  .strict();

export const WidgetWindowMetadataSchema = z
  .object({
    frame: z.enum(["none", "default"]),
    transparent: z.boolean(),
  })
  .strict();

export const WidgetUiSchema = z
  .object({
    minWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
    preferredWidth: z.number().int().positive(),
    preferredHeight: z.number().int().positive(),
  })
  .strict();

export const LegacyWidgetMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    category: z.string().min(1),
    entry: z.string().default("index.html"),
    bindings: z.array(WidgetBindingSchema).default([]),
    triggers: z.array(WidgetActionSchema).default([]),
    ui: WidgetUiSchema,
    window: WidgetWindowMetadataSchema.optional(),
  })
  .strict();

const ModernWidgetBindingSchema = z
  .object({
    type: WidgetBindingTypeSchema,
    label: z.string().min(1).optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    preview: z.unknown().optional(),
    source: z.enum(["live", "study", "presentation"]).optional(),
    staleAfterMs: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    for (const field of ["default", "preview"] as const) {
      const value = binding[field];
      if (value === undefined) continue;
      const valid = binding.type === "array" ? Array.isArray(value)
        : binding.type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
          : binding.type === "number" ? typeof value === "number" && Number.isFinite(value)
            : typeof value === binding.type;
      if (!valid) context.addIssue({ code: "custom", path: [field],
        message: `${field} value must match binding type ${binding.type}` });
    }
  });

export const ModernWidgetMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    category: z.string().min(1),
    entry: z.string().default("index.html"),
    bindings: z.record(z.string().min(1), ModernWidgetBindingSchema).default({}),
    actions: z
      .record(
        z.string().min(1),
        z
          .object({
            description: z.string().min(1),
            interactionType: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default({}),
    ui: z
      .object({
        minSize: z
          .object({
            w: z.number().int().positive(),
            h: z.number().int().positive(),
          })
          .strict(),
        preferredSize: z
          .object({
            w: z.number().int().positive(),
            h: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    window: WidgetWindowMetadataSchema.optional(),
  })
  .strict();

export const WidgetMetadataInputSchema = z.union([
  LegacyWidgetMetadataSchema,
  ModernWidgetMetadataSchema,
]);

export const WidgetMetadataSchema = WidgetMetadataInputSchema.transform(
  (metadata) => {
    if (!("actions" in metadata)) {
      return metadata;
    }

    return {
      id: metadata.id,
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      category: metadata.category,
      entry: metadata.entry,
      bindings: Object.entries(metadata.bindings).map(([key, binding]) => ({
        key,
        ...binding,
      })),
      triggers: Object.entries(metadata.actions).map(
        ([action, actionMetadata]) => ({
          action,
          description: actionMetadata.description,
          ...(actionMetadata.interactionType === undefined
            ? {}
            : { interactionType: actionMetadata.interactionType }),
        }),
      ),
      ui: {
        minWidth: metadata.ui.minSize.w,
        minHeight: metadata.ui.minSize.h,
        preferredWidth: metadata.ui.preferredSize.w,
        preferredHeight: metadata.ui.preferredSize.h,
      },
      ...(metadata.window === undefined ? {} : { window: metadata.window }),
    };
  },
);

export type WidgetBinding = z.infer<typeof WidgetBindingSchema>;
export type WidgetMetadataInput = z.input<typeof WidgetMetadataSchema>;
export type WidgetMetadata = z.output<typeof WidgetMetadataSchema>;

export const WidgetBindingDataSchema = z.object({
  source: z.enum(["live", "preview", "study", "presentation"]),
  status: z.enum(["ready", "waiting", "receiving", "stale", "disconnected", "ambiguous"]),
  sourceKey: z.string().nullable(),
  path: z.string(),
  timestamp: z.number().finite().nullable(),
  receivedAt: z.number().finite().nullable(),
  staleAfterMs: z.number().positive(),
  simulated: z.boolean().optional(),
  history: z.array(z.object({ timestamp: z.number().finite(), value: z.number().finite().nullable() }).strict()).optional(),
}).strict();
export type WidgetBindingData = z.infer<typeof WidgetBindingDataSchema>;

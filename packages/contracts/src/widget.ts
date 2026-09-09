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
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.default === undefined) return;
    const valid = binding.type === "array"
      ? Array.isArray(binding.default)
      : binding.type === "object"
        ? binding.default !== null
          && typeof binding.default === "object"
          && !Array.isArray(binding.default)
        : typeof binding.default === binding.type;
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: `Default value must match binding type ${binding.type}`,
      });
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
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.default === undefined) return;
    const valid = binding.type === "array"
      ? Array.isArray(binding.default)
      : binding.type === "object"
        ? binding.default !== null
          && typeof binding.default === "object"
          && !Array.isArray(binding.default)
        : typeof binding.default === binding.type;
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["default"],
        message: `Default value must match binding type ${binding.type}`,
      });
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

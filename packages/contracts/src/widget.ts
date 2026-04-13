import { z } from 'zod';

export const widgetBindingSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['number', 'string', 'boolean', 'object', 'array']),
  label: z.string().min(1).optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional()
});

const widgetTriggerSchema = z.object({
  action: z.string().min(1),
  description: z.string().min(1)
});

const widgetUiSchema = z.object({
  minWidth: z.number().int().positive(),
  minHeight: z.number().int().positive(),
  preferredWidth: z.number().int().positive(),
  preferredHeight: z.number().int().positive()
});

const legacyWidgetMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  category: z.string().min(1),
  entry: z.string().default('index.html'),
  bindings: z.array(widgetBindingSchema).default([]),
  triggers: z.array(widgetTriggerSchema).default([]),
  ui: widgetUiSchema
});

const modernWidgetBindingSchema = z.object({
  type: z.enum(['number', 'string', 'boolean', 'object', 'array']),
  label: z.string().min(1).optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional()
});

const modernWidgetMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  category: z.string().min(1),
  entry: z.string().default('index.html'),
  bindings: z.record(z.string().min(1), modernWidgetBindingSchema).default({}),
  actions: z.record(z.string().min(1), z.object({
    description: z.string().min(1)
  })).default({}),
  ui: z.object({
    minSize: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive()
    }),
    preferredSize: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive()
    })
  })
});

export const widgetMetadataSchema = z.union([legacyWidgetMetadataSchema, modernWidgetMetadataSchema]).transform((metadata) => {
  if (!('actions' in metadata)) {
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
      type: binding.type,
      label: binding.label,
      unit: binding.unit,
      description: binding.description,
      required: binding.required
    })),
    triggers: Object.entries(metadata.actions).map(([action, actionMetadata]) => ({
      action,
      description: actionMetadata.description
    })),
    ui: {
      minWidth: metadata.ui.minSize.w,
      minHeight: metadata.ui.minSize.h,
      preferredWidth: metadata.ui.preferredSize.w,
      preferredHeight: metadata.ui.preferredSize.h
    }
  };
});

export type WidgetMetadata = z.infer<typeof widgetMetadataSchema>;

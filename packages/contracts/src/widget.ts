import { z } from 'zod';

export const widgetBindingSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['number', 'string', 'boolean', 'object', 'array']),
  label: z.string().min(1).optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional()
});

export const widgetMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  category: z.enum(['driving', 'communication', 'health', 'study', 'general']),
  entry: z.string().default('index.html'),
  bindings: z.array(widgetBindingSchema).default([]),
  triggers: z.array(z.object({
    action: z.string().min(1),
    description: z.string().min(1)
  })).default([]),
  ui: z.object({
    minWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
    preferredWidth: z.number().int().positive(),
    preferredHeight: z.number().int().positive()
  })
});

export type WidgetMetadata = z.infer<typeof widgetMetadataSchema>;

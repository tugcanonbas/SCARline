import { z } from 'zod';

export const zoneSchema = z.object({
  id: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  display: z.number().int().nonnegative().default(0)
});

export const widgetInstanceSchema = z.object({
  id: z.string().uuid(),
  widgetId: z.string().min(1),
  zoneId: z.string().min(1),
  order: z.number().int().default(0),
  x: z.number().int().default(0),
  y: z.number().int().default(0),
  width: z.number().int().positive().default(180),
  height: z.number().int().positive().default(180),
  bindingsConfig: z.record(z.string(), z.unknown()).default({}),
  triggerRules: z.array(z.record(z.string(), z.unknown())).default([]),
  styleOverrides: z.record(z.string(), z.unknown()).default({})
});

export const layoutConfigSchema = z.object({
  id: z.string().uuid().optional(),
  studyId: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['participant', 'researcher_monitor']),
  targetDisplay: z.string().default('0'),
  isTransparent: z.boolean().default(true),
  zones: z.array(zoneSchema).min(1),
  widgets: z.array(widgetInstanceSchema).default([])
});

export type LayoutConfig = z.infer<typeof layoutConfigSchema>;

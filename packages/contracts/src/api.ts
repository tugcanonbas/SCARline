import { z } from 'zod';
import { ComponentIdSchema, HealthStatusSchema, RoleSchema, SessionStatusSchema, StudyStatusSchema } from './enums.js';
import { layoutConfigSchema } from './layout.js';

export const apiSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    error: z.null()
  });

export const apiErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  data: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).default({})
  })
});

export const tokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  roles: z.array(RoleSchema).min(1),
  displayName: z.string(),
  iat: z.number().int(),
  exp: z.number().int()
});

export const onboardingSystemSchema = z.object({
  carlaServerPath: z.string().min(1).nullable(),
  dataDirectory: z.string().min(1),
  platformPort: z.number().int().positive(),
  carlaServerPort: z.number().int().positive(),
  transparentOverlayEnabled: z.boolean().default(true)
});

export const onboardingResearcherSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  institution: z.string().optional(),
  role: z.string().optional(),
  username: z.string().min(1),
  password: z.string().min(8)
});

export const studySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: StudyStatusSchema,
  participantCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const participantSchema = z.object({
  id: z.string().uuid(),
  studyId: z.string().uuid(),
  participantCode: z.string(),
  demographicData: z.record(z.string(), z.unknown()).default({}),
  assignedConditionId: z.string().uuid().nullable(),
  notes: z.string().nullable()
});

export const conditionSchema = z.object({
  id: z.string().uuid(),
  studyId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  carlaOverrides: z.record(z.string(), z.unknown()).default({}),
  widgetOverrides: z.record(z.string(), z.unknown()).default({})
});

export const sessionSchema = z.object({
  id: z.string().uuid(),
  studyId: z.string().uuid(),
  participantId: z.string().uuid().nullable(),
  conditionId: z.string().uuid().nullable(),
  name: z.string().nullable(),
  status: SessionStatusSchema,
  startedAt: z.string().datetime().nullable(),
  pausedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nullable(),
  runtimeMetadata: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().nullable()
});

export const dashboardSchema = z.object({
  activeStudies: z.number().int().nonnegative(),
  totalSessions: z.number().int().nonnegative(),
  totalParticipants: z.number().int().nonnegative(),
  totalEvents: z.number().int().nonnegative(),
  recentSessions: z.array(sessionSchema),
  componentHealth: z.array(z.object({
    componentId: ComponentIdSchema,
    status: HealthStatusSchema,
    checkedAt: z.string().datetime(),
    message: z.string().optional()
  }))
});

export const componentStatusSchema = z.object({
  componentId: ComponentIdSchema,
  componentName: z.string(),
  status: HealthStatusSchema,
  message: z.string().optional(),
  checkedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const systemConfigurationSchema = onboardingSystemSchema.extend({
  onboardingCompleted: z.boolean(),
  environment: z.enum(['development', 'production']).default('development')
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    roles: z.array(RoleSchema)
  })
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const widgetCatalogueItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  previewUrl: z.string().optional()
});

export const activeStudyPayloadSchema = z.object({
  session: sessionSchema.nullable(),
  layout: layoutConfigSchema.nullable(),
  triggerableWidgets: z.array(widgetCatalogueItemSchema),
  telemetry: z.record(z.string(), z.unknown()).default({})
});

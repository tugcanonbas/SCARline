import { z } from 'zod';

export const RoleSchema = z.enum(['admin', 'researcher', 'operator', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const HealthStatusSchema = z.enum(['healthy', 'degraded', 'error', 'disconnected', 'running', 'stopped']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const SessionStatusSchema = z.enum(['created', 'running', 'paused', 'completed', 'cancelled']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const StudyStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']);
export type StudyStatus = z.infer<typeof StudyStatusSchema>;

export const WidgetStateSchema = z.enum(['visible', 'hidden', 'highlighted', 'idle', 'paused']);
export type WidgetState = z.infer<typeof WidgetStateSchema>;

export const ComponentIdSchema = z.enum([
  'database',
  'rabbitmq',
  'core-api',
  'sim-bridge',
  'mock-simulator',
  'carla-client',
  'carla-server',
  'io-client',
  'overlay-web',
  'overlay-desktop',
  'nginx'
]);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

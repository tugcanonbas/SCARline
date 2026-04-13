import { z } from 'zod';

export const processManagerCommandSchema = z.object({
  path: z.enum([
    '/carla/start',
    '/carla/stop',
    '/carla/restart',
    '/carla/status',
    '/overlay/reload',
    '/restart',
    '/status'
  ]),
  method: z.enum(['GET', 'POST']),
  body: z.record(z.string(), z.unknown()).optional()
});

export const processManagerStatusSchema = z.object({
  processManager: z.enum(['running', 'stopped']),
  carlaServer: z.enum(['running', 'stopped', 'error']),
  overlayDesktop: z.enum(['running', 'stopped', 'error']),
  supervisor: z.enum(['running', 'stopped', 'error']).optional(),
  docker: z.enum(['running', 'stopped', 'error']),
  checkedAt: z.string().datetime()
});

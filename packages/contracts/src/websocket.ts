import { z } from 'zod';

export const SIM_BRIDGE_WEBSOCKET_PATHS = {
  adapter: '/adapter',
  bridgeCompatibility: '/bridge'
} as const;

export const websocketChannelSchema = z.enum([
  'session.events',
  'session.telemetry',
  'widget.updates',
  'system.health',
  'sensor.status',
  'export.progress'
]);

export type WebSocketChannel = z.infer<typeof websocketChannelSchema>;

export const websocketSubscriptionMessageSchema = z.object({
  action: z.enum(['subscribe', 'unsubscribe']),
  channels: z.array(websocketChannelSchema).min(1),
  filters: z.object({
    studyId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional()
  }).optional()
});

export const websocketDataMessageSchema = z.object({
  type: z.enum(['event', 'command-response', 'error']),
  channel: websocketChannelSchema,
  data: z.record(z.string(), z.unknown())
});

export const exportProgressWebSocketPayloadSchema = z.object({
  exportJobId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().int().min(0).max(100),
  artifactPath: z.string().optional(),
  errorMessage: z.string().optional()
});

export type WebSocketSubscriptionMessage = z.infer<typeof websocketSubscriptionMessageSchema>;
export type WebSocketDataMessage = z.infer<typeof websocketDataMessageSchema>;

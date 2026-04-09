import { z } from 'zod';

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
  channels: z.array(websocketChannelSchema).min(1)
});

export const websocketDataMessageSchema = z.object({
  type: z.enum(['event', 'command-response', 'error']),
  channel: websocketChannelSchema,
  data: z.record(z.string(), z.unknown())
});

export type WebSocketSubscriptionMessage = z.infer<typeof websocketSubscriptionMessageSchema>;
export type WebSocketDataMessage = z.infer<typeof websocketDataMessageSchema>;

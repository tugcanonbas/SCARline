import { z } from 'zod';

export const RABBITMQ_EXCHANGES = {
  events: 'scarline.events',
  commands: 'scarline.commands',
  dlx: 'scarline.dlx'
} as const;

export const RABBITMQ_QUEUES = {
  coreApiEvents: 'scarline.core-api.events',
  coreApiCommands: 'scarline.core-api.commands',
  simBridgeCommands: 'scarline.sim-bridge.commands',
  ioClientCommands: 'scarline.io-client.commands',
  exportCommands: 'scarline.export.commands',
  dlq: 'scarline.dlq'
} as const;

export const messageMetadataSchema = z.object({
  studyId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  correlationId: z.string().uuid().nullable()
});

export const rabbitMessageSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  routingKey: z.string().min(1),
  producer: z.string().min(1),
  type: z.enum(['event', 'command']),
  payload: z.record(z.string(), z.unknown()).default({}),
  metadata: messageMetadataSchema
});

export type RabbitMessage = z.infer<typeof rabbitMessageSchema>;

export const eventRoutingKeySchema = z.string().regex(/^events\.[^.]+\.[^.]+\.[^.]+\.[^.]+$/);
export const commandRoutingKeySchema = z.string().regex(/^commands\.[^.]+\.[^.]+$/);

export const simulatorCommandActionSchema = z.enum([
  'load-map',
  'set-weather',
  'spawn-vehicle',
  'configure-sensors',
  'set-traffic',
  'set-spectator',
  'apply-control',
  'start-recording',
  'stop-recording'
]);

export const coreCommandActionSchema = z.enum([
  'start',
  'pause',
  'resume',
  'complete',
  'cancel'
]);

export const widgetCommandActionSchema = z.enum(['trigger', 'update-bindings']);
export const exportCommandActionSchema = z.enum(['create', 'cancel']);
export const ioCommandActionSchema = z.enum(['start-session', 'stop-session']);

export function makeEventRoutingKey(
  studyId: string | 'system',
  runId: string | 'global',
  modality: string,
  eventType: string
): string {
  return `events.${studyId}.${runId}.${modality}.${eventType}`;
}

export function makeCommandRoutingKey(target: string, action: string): string {
  return `commands.${target}.${action}`;
}

export const widgetTriggeredPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  widgetId: z.string().min(1),
  triggerType: z.enum(['manual', 'automatic', 'configurable']),
  source: z.enum(['researcher-trigger', 'rule-engine']),
  operatorId: z.string().uuid().optional(),
  bindingValues: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).default({})
});

export const sensorStatusPayloadSchema = z.object({
  driverId: z.string(),
  sensorType: z.string(),
  connected: z.boolean(),
  sampleRate: z.number().int().nonnegative(),
  message: z.string().optional(),
  checkedAt: z.string().datetime()
});

export const sessionLifecycleCommandSchema = z.object({
  sessionId: z.string().uuid(),
  studyId: z.string().uuid().optional(),
  participantId: z.string().uuid().optional(),
  conditionId: z.string().uuid().optional(),
  reason: z.string().optional()
});

export const ioSessionCommandSchema = z.object({
  sessionId: z.string().uuid(),
  studyId: z.string().uuid(),
  sensors: z.array(z.record(z.string(), z.unknown())).default([])
});

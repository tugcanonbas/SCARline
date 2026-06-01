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

export const eventRoutingKeySchema = z.string().regex(/^events\.[^.]+\.[^.]+\.[^.]+\..+$/);
export const commandRoutingKeySchema = z.string().regex(/^commands\.[^.]+\.[^.]+$/);

export const SIMULATOR_EVENT_TYPES = {
  vehicleTelemetry: 'vehicle.telemetry',
  vehicleCollision: 'vehicle.collision',
  vehicleLaneInvasion: 'vehicle.lane_invasion',
  worldSnapshot: 'world.snapshot',
  sensorCamera: 'sensor.camera',
  sensorLidar: 'sensor.lidar',
  sensorGnss: 'sensor.gnss',
  sensorImu: 'sensor.imu',
  adapterHeartbeat: 'adapter.heartbeat'
} as const;

export const simulatorEventTypeSchema = z.enum([
  SIMULATOR_EVENT_TYPES.vehicleTelemetry,
  SIMULATOR_EVENT_TYPES.vehicleCollision,
  SIMULATOR_EVENT_TYPES.vehicleLaneInvasion,
  SIMULATOR_EVENT_TYPES.worldSnapshot,
  SIMULATOR_EVENT_TYPES.sensorCamera,
  SIMULATOR_EVENT_TYPES.sensorLidar,
  SIMULATOR_EVENT_TYPES.sensorGnss,
  SIMULATOR_EVENT_TYPES.sensorImu,
  SIMULATOR_EVENT_TYPES.adapterHeartbeat
]);

export const IO_EVENT_TYPES = {
  steering: 'io.steering',
  camera: 'io.camera',
  driverStatus: 'io.driver_status',
  blink: 'io.blink',
  gesture: 'io.gesture',
  eyeTracker: 'io.eye_tracker',
  heartRate: 'io.heart_rate'
} as const;

export const ioEventTypeSchema = z.enum([
  IO_EVENT_TYPES.steering,
  IO_EVENT_TYPES.camera,
  IO_EVENT_TYPES.driverStatus,
  IO_EVENT_TYPES.blink,
  IO_EVENT_TYPES.gesture,
  IO_EVENT_TYPES.eyeTracker,
  IO_EVENT_TYPES.heartRate
]);

export const simulatorCommandActionSchema = z.enum([
  'bind-session',
  'unbind-session',
  'pause-session',
  'resume-session',
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
  checkedAt: z.string().datetime(),
  capabilities: z.array(z.string()).default([]),
  configSchema: z.record(z.string(), z.unknown()).default({}),
  degraded: z.boolean().default(false)
});

export const simulatorRuntimeEventPayloadSchema = z.object({
  timestamp: z.string().datetime().optional(),
  frame: z.number().int().nonnegative().optional(),
  vehicle: z.record(z.string(), z.unknown()).optional(),
  sensorId: z.string().optional(),
  dataRef: z.string().optional(),
  scenario: z.string().optional()
}).passthrough();

export const exportProgressPayloadSchema = z.object({
  exportJobId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().int().min(0).max(100),
  artifactPath: z.string().optional(),
  errorMessage: z.string().optional()
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

// ---------------------------------------------------------------------------
// IO Sensor Event Payload Schemas
// ---------------------------------------------------------------------------

export const ioBlinkEventPayloadSchema = z.object({
  earLeft: z.number().nullable(),
  earRight: z.number().nullable(),
  earAvg: z.number().nullable(),
  blinkDetected: z.boolean(),
  blinkCount: z.number().int().nonnegative(),
  eyesClosed: z.boolean(),
  connected: z.boolean()
});

export const ioGestureEventPayloadSchema = z.object({
  gestureId: z.string(),
  confidence: z.number().min(0).max(1),
  handedness: z.enum(['left', 'right', 'unknown']),
  connected: z.boolean()
});

export const ioEyeTrackerEventPayloadSchema = z.object({
  gaze: z.object({
    x: z.number().nullable(),
    y: z.number().nullable()
  }),
  pupilDiameter: z.number().nullable(),
  connected: z.boolean()
});

export const ioHeartRateEventPayloadSchema = z.object({
  heartRateBpm: z.number().nullable(),
  rrIntervalMs: z.number().nullable(),
  connected: z.boolean()
});

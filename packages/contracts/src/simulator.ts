import { z } from "zod";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  UuidSchema,
} from "./common.js";

export const SIMULATOR_ADAPTER_PROTOCOL_VERSION = 1 as const;

export const SimulatorTypeSchema = z.enum(["carla", "mock"]);

export const CarlaControlModeSchema = z.enum(["io", "autopilot", "external"]);

const CarlaVectorSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
}).strict();

export const CarlaSensorConfigurationSchema = z.object({
  type: z.string().regex(/^sensor\.[a-z0-9_.-]+$/),
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  attributes: JsonObjectSchema,
  transform: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    pitch: z.number().default(0),
    yaw: z.number().default(0),
    roll: z.number().default(0),
  }).strict(),
}).strict();

export const CarlaSessionConfigurationSchema = z.object({
  map: z.string().trim().min(1).max(200),
  weatherPreset: z.string().trim().min(1).max(100).nullable(),
  weatherCustom: z.object({
    cloudiness: z.number().min(0).max(100),
    precipitation: z.number().min(0).max(100),
    windIntensity: z.number().min(0).max(100),
  }).strict(),
  egoVehicleBlueprint: z.string().regex(/^vehicle\.[a-z0-9_.-]+$/),
  simulationMode: z.literal("synchronous"),
  fixedDeltaSeconds: z.literal(0.05),
  controlMode: CarlaControlModeSchema,
  randomSeed: z.number().int().min(0).max(2_147_483_647),
  trafficConfig: z.object({
    npcVehicleCount: z.number().int().min(0).max(200),
    speedDifference: z.number().min(-100).max(100),
    speedLimitOverride: z.number().min(0).max(300).nullable().optional(),
  }).strict(),
  pedestrianConfig: z.object({
    pedestrianCount: z.number().int().min(0).max(200),
  }).strict(),
  sunConfig: z.object({
    sunAltitudeAngle: z.number().min(-90).max(90),
  }).strict(),
  spectatorConfig: z.object({
    enabled: z.boolean(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    pitch: z.number(),
    yaw: z.number(),
    roll: z.number(),
  }).strict(),
  recordingConfig: z.object({
    enabled: z.boolean(),
    directory: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).*$/).nullable(),
  }).strict(),
  sensors: z.array(CarlaSensorConfigurationSchema).max(100),
}).strict();

export const SimulatorAdapterCapabilitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9.-]*$/);

export const SimulatorCommandNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);

const ProtocolFields = {
  version: z.literal(SIMULATOR_ADAPTER_PROTOCOL_VERSION),
  id: UuidSchema,
  timestamp: IsoDateTimeSchema,
} as const;

const CommandFields = {
  ...ProtocolFields,
  commandId: UuidSchema,
  studyId: UuidSchema,
  sessionId: UuidSchema,
  deadlineAt: IsoDateTimeSchema,
} as const;

export const SimulatorSessionConfigurationSchema = z
  .object({
    studyId: UuidSchema,
    sessionId: UuidSchema,
    sessionConditionId: UuidSchema,
    sequence: z.number().int().nonnegative(),
    simulatorType: SimulatorTypeSchema,
    configuration: JsonObjectSchema,
  })
  .strict();

export const AdapterRegisterMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("adapter.register"),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(100),
    simulatorType: SimulatorTypeSchema,
    simulatorVersion: z.string().trim().min(1).max(100),
    capabilities: z.array(SimulatorAdapterCapabilitySchema).max(100),
    priority: z.number().int().min(0).max(10_000),
    activeSessionId: z.union([UuidSchema, z.null()]),
  })
  .strict();

export const AdapterRegisteredMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("adapter.registered"),
    correlationId: UuidSchema,
    assignedId: UuidSchema,
    heartbeatIntervalMilliseconds: z.number().int().positive(),
    maximumMessageBytes: z.number().int().positive(),
  })
  .strict();

export const AdapterHeartbeatMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("adapter.heartbeat"),
    status: z.enum(["ready", "busy", "degraded"]),
    activeSessionId: z.union([UuidSchema, z.null()]),
  })
  .strict();

export const AdapterBindSessionMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.bind_session"),
    sessionConditionId: UuidSchema,
    sequence: z.number().int().nonnegative(),
    simulatorType: SimulatorTypeSchema,
    configuration: JsonObjectSchema,
  })
  .strict();

export const AdapterPauseSessionMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.pause_session"),
  })
  .strict();

export const AdapterResumeSessionMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.resume_session"),
  })
  .strict();

export const AdapterAdvanceSessionMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.advance_session"),
    sessionConditionId: UuidSchema,
    sequence: z.number().int().nonnegative(),
    simulatorType: SimulatorTypeSchema,
    configuration: JsonObjectSchema,
  })
  .strict();

export const AdapterUnbindSessionMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.unbind_session"),
    reason: z.enum(["complete", "abort"]),
  })
  .strict();

export const AdapterSimulatorCommandMessageSchema = z
  .object({
    ...CommandFields,
    type: z.literal("adapter.simulator_command"),
    sessionConditionId: UuidSchema,
    command: SimulatorCommandNameSchema,
    parameters: JsonObjectSchema,
    requiredCapability: z.union([SimulatorAdapterCapabilitySchema, z.null()]),
  })
  .strict();

export const AdapterVehicleControlMessageSchema = z.object({
  ...ProtocolFields,
  type: z.literal("adapter.vehicle_control"),
  studyId: UuidSchema,
  sessionId: UuidSchema,
  sessionConditionId: UuidSchema,
  sourceKey: z.string().trim().min(1).max(200),
  sequence: z.number().int().nonnegative(),
  sourceTimestamp: IsoDateTimeSchema,
  throttle: z.number().min(0).max(1),
  steer: z.number().min(-1).max(1),
  brake: z.number().min(0).max(1),
}).strict();

export const AdapterCommandResultMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("adapter.command_result"),
    commandId: UuidSchema,
    success: z.boolean(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().max(2_000),
    details: JsonObjectSchema,
    activeSessionId: z.union([UuidSchema, z.null()]),
  })
  .strict();

export const VehicleTelemetryMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("vehicle.telemetry"),
    speed: z.number().nonnegative(),
    speedLimit: z.number().nonnegative().optional(),
    throttle: z.number().min(0).max(1),
    steer: z.number().min(-1).max(1),
    brake: z.number().min(0).max(1),
  })
  .strict();

export const SimulatorCollisionMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("simulator.collision"),
    otherActor: z.string().trim().min(1).max(200),
    impulse: z.number().nonnegative(),
  })
  .strict();

export const SimulatorLaneInvasionMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("simulator.lane_invasion"),
    markings: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .strict();

export const SimulatorStateMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("simulator.state"),
    state: z.enum(["loading", "ready", "running", "paused", "stopped"]),
    details: JsonObjectSchema,
  })
  .strict();

export const SimulatorGnssMessageSchema = z.object({
  ...ProtocolFields,
  type: z.literal("simulator.gnss"),
  sensorId: z.string().trim().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number(),
}).strict();

export const SimulatorImuMessageSchema = z.object({
  ...ProtocolFields,
  type: z.literal("simulator.imu"),
  sensorId: z.string().trim().min(1).max(100),
  accelerometer: CarlaVectorSchema,
  gyroscope: CarlaVectorSchema,
  compass: z.number(),
}).strict();

export const SimulatorSensorArtifactMessageSchema = z.object({
  ...ProtocolFields,
  type: z.literal("simulator.sensor_artifact"),
  sensorId: z.string().trim().min(1).max(100),
  kind: z.enum(["camera", "lidar", "recorder"]),
  frame: z.number().int().nonnegative().nullable(),
  reference: z.string().regex(/^carla:\/\/[a-zA-Z0-9._/-]+$/).max(2_000),
  metadata: JsonObjectSchema,
}).strict();

export const RealtimeVehicleControlSchema = z.object({
  version: z.literal(1),
  id: UuidSchema,
  timestamp: IsoDateTimeSchema,
  type: z.literal("vehicle.control"),
  studyId: UuidSchema,
  sessionId: UuidSchema,
  sessionConditionId: UuidSchema,
  sourceKey: z.string().trim().min(1).max(200),
  sequence: z.number().int().nonnegative(),
  throttle: z.number().min(0).max(1),
  steer: z.number().min(-1).max(1),
  brake: z.number().min(0).max(1),
}).strict();

export const AdapterErrorMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("adapter.error"),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1).max(2_000),
    fatal: z.boolean(),
    details: JsonObjectSchema,
  })
  .strict();

export const BridgeErrorMessageSchema = z
  .object({
    ...ProtocolFields,
    type: z.literal("bridge.error"),
    correlationId: z.union([UuidSchema, z.null()]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const BridgeToAdapterMessageSchema = z.discriminatedUnion("type", [
  AdapterRegisteredMessageSchema,
  AdapterBindSessionMessageSchema,
  AdapterPauseSessionMessageSchema,
  AdapterResumeSessionMessageSchema,
  AdapterAdvanceSessionMessageSchema,
  AdapterUnbindSessionMessageSchema,
  AdapterSimulatorCommandMessageSchema,
  AdapterVehicleControlMessageSchema,
  BridgeErrorMessageSchema,
]);

export const AdapterToBridgeMessageSchema = z.discriminatedUnion("type", [
  AdapterRegisterMessageSchema,
  AdapterHeartbeatMessageSchema,
  AdapterCommandResultMessageSchema,
  VehicleTelemetryMessageSchema,
  SimulatorCollisionMessageSchema,
  SimulatorLaneInvasionMessageSchema,
  SimulatorStateMessageSchema,
  SimulatorGnssMessageSchema,
  SimulatorImuMessageSchema,
  SimulatorSensorArtifactMessageSchema,
  AdapterErrorMessageSchema,
]);

export const SimulatorAdapterMessageSchema = z.union([
  BridgeToAdapterMessageSchema,
  AdapterToBridgeMessageSchema,
]);

const LifecycleBaseFields = {
  commandId: UuidSchema,
  sessionId: UuidSchema,
  deadlineAt: IsoDateTimeSchema,
} as const;

const LifecycleWithConfigurationSchema = z
  .object({
    ...LifecycleBaseFields,
    action: z.enum(["start", "advance"]),
    configuration: SimulatorSessionConfigurationSchema,
  })
  .strict();

const LifecycleWithoutConfigurationSchema = z
  .object({
    ...LifecycleBaseFields,
    action: z.enum(["pause", "resume", "complete", "abort"]),
  })
  .strict();

export const SimBridgeLifecycleCommandSchema = z.union([
  LifecycleWithConfigurationSchema,
  LifecycleWithoutConfigurationSchema,
]);

export const SimBridgeSimulatorCommandSchema = z
  .object({
    commandId: UuidSchema,
    sessionId: UuidSchema,
    sessionConditionId: UuidSchema,
    command: SimulatorCommandNameSchema,
    parameters: JsonObjectSchema,
    requiredCapability: z.union([SimulatorAdapterCapabilitySchema, z.null()]),
    triggerRuleId: UuidSchema,
    deadlineAt: IsoDateTimeSchema,
  })
  .strict();

export const SimBridgeCommandAcknowledgementSchema = z
  .object({
    commandId: UuidSchema,
    component: z.literal("sim-bridge"),
    status: z.enum(["completed", "failed"]),
    error: z.string().max(2_000).nullable(),
    warning: z.string().max(2_000).nullable(),
  })
  .strict();

export type SimulatorType = z.infer<typeof SimulatorTypeSchema>;
export type CarlaSessionConfiguration = z.infer<typeof CarlaSessionConfigurationSchema>;
export type RealtimeVehicleControl = z.infer<typeof RealtimeVehicleControlSchema>;
export type SimulatorSessionConfiguration = z.infer<typeof SimulatorSessionConfigurationSchema>;
export type AdapterRegisterMessage = z.infer<typeof AdapterRegisterMessageSchema>;
export type AdapterCommandResultMessage = z.infer<typeof AdapterCommandResultMessageSchema>;
export type BridgeToAdapterMessage = z.infer<typeof BridgeToAdapterMessageSchema>;
export type AdapterToBridgeMessage = z.infer<typeof AdapterToBridgeMessageSchema>;
export type SimulatorAdapterMessage = z.infer<typeof SimulatorAdapterMessageSchema>;
export type SimBridgeLifecycleCommand = z.infer<typeof SimBridgeLifecycleCommandSchema>;
export type SimBridgeSimulatorCommand = z.infer<typeof SimBridgeSimulatorCommandSchema>;
export type SimBridgeCommandAcknowledgement = z.infer<typeof SimBridgeCommandAcknowledgementSchema>;

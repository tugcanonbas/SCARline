export * from "./common.js";
export * from "./api.js";
export * from "./auth.js";
export * from "./config.js";
export * from "./domain.js";
export * from "./events.js";
export * from "./export.js";
export * from "./health.js";
export * from "./layout.js";
export * from "./messaging.js";
export * from "./readiness.js";
export * from "./session.js";
export * from "./trigger.js";
export * from "./simulator.js";
export * from "./sensor.js";
export * from "./io.js";
export * from "./websocket.js";
export * from "./widget.js";

import { ApiErrorEnvelopeSchema } from "./api.js";
import {
  AccessTokenClaimsSchema,
  AccessTokenResponseSchema,
  LoginRequestSchema,
  NewPasswordSchema,
  OverlayBootstrapTokenClaimsSchema,
  OverlayRenderSessionClaimsSchema,
  OverlayWebSocketTicketClaimsSchema,
  UserWebSocketTicketClaimsSchema,
  UserWebSocketTicketHeadersSchema,
  UserWebSocketTicketResponseSchema,
  WebSocketAuthHeadersSchema,
} from "./auth.js";
import { EnvironmentSecretsSchema, ScarlineConfigSchema } from "./config.js";
import {
  ConditionSchema,
  ParticipantSchema,
  SessionConditionSchema,
  SessionSchema,
  StudySchema,
  UserSchema,
} from "./domain.js";
import { ExportProgressPayloadSchema } from "./export.js";
import { SessionEventAggregateResponseSchema } from "./events.js";
import { PlatformHealthSchema } from "./health.js";
import {
  LayoutSchema,
  OverlayControlMessageSchema,
  OverlayDisplaySchema,
  OverlayHostCommandSchema,
  OverlayHostEventSchema,
  OverlayRuntimeServerMessageSchema,
  OverlayRuntimeSnapshotSchema,
  WidgetRuntimeCommandSchema,
  WidgetInstanceSchema,
} from "./layout.js";
import { MessageEnvelopeSchema } from "./messaging.js";
import { StudyReadinessSchema } from "./readiness.js";
import {
  IoCommandAcknowledgementSchema,
  IoDeviceDiscoveryPayloadSchema,
  IoDriverManifestSchema,
  IoLifecycleCommandSchema,
  IoSensorBatchPayloadSchema,
  IoSessionConfigurationSchema,
} from "./io.js";
import { SessionTransitionSchema } from "./session.js";
import { TriggerExpressionSchema } from "./trigger.js";
import {
  BlinkEventPayloadSchema,
  EcgEventPayloadSchema,
  EyeTrackerEventPayloadSchema,
  GestureEventPayloadSchema,
  HeartRateEventPayloadSchema,
  SensorStatusPayloadSchema,
} from "./sensor.js";
import {
  AdapterBindSessionMessageSchema,
  AdapterCommandResultMessageSchema,
  AdapterRegisterMessageSchema,
  AdapterUnbindSessionMessageSchema,
  AdapterVehicleControlMessageSchema,
  BridgeToAdapterMessageSchema,
  AdapterToBridgeMessageSchema,
  CarlaSessionConfigurationSchema,
  RealtimeVehicleControlSchema,
  SimBridgeCommandAcknowledgementSchema,
  SimBridgeLifecycleCommandSchema,
  SimBridgeSimulatorCommandSchema,
  SimulatorSessionConfigurationSchema,
  SimulatorAdapterMessageSchema,
  VehicleTelemetryMessageSchema,
} from "./simulator.js";
import {
  WebSocketClientMessageSchema,
  WebSocketServerMessageSchema,
} from "./websocket.js";
import { WidgetMetadataInputSchema } from "./widget.js";

export const jsonSchemaSources = {
  "environment-secrets": EnvironmentSecretsSchema,
  "scarline-config": ScarlineConfigSchema,
  "api-error-envelope": ApiErrorEnvelopeSchema,
  "login-request": LoginRequestSchema,
  "new-password": NewPasswordSchema,
  "access-token-claims": AccessTokenClaimsSchema,
  "access-token-response": AccessTokenResponseSchema,
  "user-websocket-ticket-claims": UserWebSocketTicketClaimsSchema,
  "user-websocket-ticket-headers": UserWebSocketTicketHeadersSchema,
  "user-websocket-ticket-response": UserWebSocketTicketResponseSchema,
  "overlay-bootstrap-token-claims": OverlayBootstrapTokenClaimsSchema,
  "overlay-render-session-claims": OverlayRenderSessionClaimsSchema,
  "overlay-websocket-ticket-claims": OverlayWebSocketTicketClaimsSchema,
  "websocket-auth-headers": WebSocketAuthHeadersSchema,
  user: UserSchema,
  study: StudySchema,
  participant: ParticipantSchema,
  condition: ConditionSchema,
  session: SessionSchema,
  "session-condition": SessionConditionSchema,
  "platform-health": PlatformHealthSchema,
  layout: LayoutSchema,
  "widget-instance": WidgetInstanceSchema,
  "overlay-display": OverlayDisplaySchema,
  "overlay-control-message": OverlayControlMessageSchema,
  "overlay-host-command": OverlayHostCommandSchema,
  "overlay-host-event": OverlayHostEventSchema,
  "overlay-runtime-snapshot": OverlayRuntimeSnapshotSchema,
  "overlay-runtime-server-message": OverlayRuntimeServerMessageSchema,
  "widget-runtime-command": WidgetRuntimeCommandSchema,
  "widget-metadata-input": WidgetMetadataInputSchema,
  "sensor-status": SensorStatusPayloadSchema,
  "sensor-blink-event": BlinkEventPayloadSchema,
  "sensor-gesture-event": GestureEventPayloadSchema,
  "sensor-eye-tracker-event": EyeTrackerEventPayloadSchema,
  "sensor-heart-rate-event": HeartRateEventPayloadSchema,
  "sensor-ecg-event": EcgEventPayloadSchema,
  "export-progress": ExportProgressPayloadSchema,
  "session-event-aggregate-response": SessionEventAggregateResponseSchema,
  "message-envelope": MessageEnvelopeSchema,
  "study-readiness": StudyReadinessSchema,
  "io-driver-manifest": IoDriverManifestSchema,
  "io-session-configuration": IoSessionConfigurationSchema,
  "io-lifecycle-command": IoLifecycleCommandSchema,
  "io-command-acknowledgement": IoCommandAcknowledgementSchema,
  "io-device-discovery": IoDeviceDiscoveryPayloadSchema,
  "io-sensor-batch": IoSensorBatchPayloadSchema,
  "session-transition": SessionTransitionSchema,
  "trigger-expression": TriggerExpressionSchema,
  "adapter-register": AdapterRegisterMessageSchema,
  "adapter-bind-session": AdapterBindSessionMessageSchema,
  "adapter-unbind-session": AdapterUnbindSessionMessageSchema,
  "adapter-vehicle-control": AdapterVehicleControlMessageSchema,
  "adapter-command-result": AdapterCommandResultMessageSchema,
  "adapter-to-bridge-message": AdapterToBridgeMessageSchema,
  "bridge-to-adapter-message": BridgeToAdapterMessageSchema,
  "vehicle-telemetry": VehicleTelemetryMessageSchema,
  "simulator-adapter-message": SimulatorAdapterMessageSchema,
  "simulator-session-configuration": SimulatorSessionConfigurationSchema,
  "carla-session-configuration": CarlaSessionConfigurationSchema,
  "realtime-vehicle-control": RealtimeVehicleControlSchema,
  "sim-bridge-lifecycle-command": SimBridgeLifecycleCommandSchema,
  "sim-bridge-simulator-command": SimBridgeSimulatorCommandSchema,
  "sim-bridge-command-acknowledgement": SimBridgeCommandAcknowledgementSchema,
  "websocket-client-message": WebSocketClientMessageSchema,
  "websocket-server-message": WebSocketServerMessageSchema,
} as const;

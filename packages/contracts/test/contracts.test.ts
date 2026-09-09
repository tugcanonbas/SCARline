import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parse } from "yaml";

import {
  AccessTokenResponseSchema,
  AdapterBindSessionMessageSchema,
  BlinkEventPayloadSchema,
  CarlaSessionConfigurationSchema,
  ComponentIdSchema,
  CommandRoutingKeySchema,
  EnvironmentSecretsSchema,
  EventRoutingKeySchema,
  LoginRequestSchema,
  LayoutSchema,
  MessageEnvelopeSchema,
  NewPasswordSchema,
  OverlayControlMessageSchema,
  OverlayHostCommandSchema,
  OverlayHostEventSchema,
  OverlayRuntimeSnapshotSchema,
  OverlayRuntimeServerMessageSchema,
  OverlayWindowStatusPayloadSchema,
  ParticipantLayoutBulkSaveSchema,
  SessionParticipantWindowSaveSchema,
  SessionEventAggregateQuerySchema,
  SessionEventAggregateResponseSchema,
  ParticipantSchema,
  RealtimeVehicleControlSchema,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_OPTIONS,
  OVERLAY_RENDER_COOKIE_NAME,
  OVERLAY_RENDER_COOKIE_OPTIONS,
  RoleSchema,
  ScarlineConfigSchema,
  SessionConditionSchema,
  SessionTransitionSchema,
  SimBridgeLifecycleCommandSchema,
  StudyStatusSchema,
  StudyReadinessSchema,
  TriggerExpressionSchema,
  WidgetMetadataSchema,
  WidgetRuntimeCommandSchema,
  VehicleTelemetryMessageSchema,
  WebSocketClientMessageSchema,
  WebSocketAuthHeadersSchema,
  WebSocketServerMessageSchema,
  UserWebSocketTicketClaimsSchema,
  UserWebSocketTicketHeadersSchema,
  UserWebSocketTicketResponseSchema,
  canTransitionSession,
} from "../src/index.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const studyId = "550e8400-e29b-41d4-a716-446655440000";
const sessionId = "550e8400-e29b-41d4-a716-446655440001";

test("validates the committed bootstrap configuration", () => {
  const config = parse(
    readFileSync(new URL("config.yml", repositoryRoot), "utf8"),
  );

  assert.doesNotThrow(() => ScarlineConfigSchema.parse(config));
});

test("requires every current environment secret", () => {
  const environment = Object.fromEntries(
    readFileSync(new URL(".env.example", repositoryRoot), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

  assert.doesNotThrow(() => EnvironmentSecretsSchema.parse(environment));
  assert.throws(() =>
    EnvironmentSecretsSchema.parse({ POSTGRES_PASSWORD: "database-secret" }),
  );
});

test("enforces the session lifecycle including ready to aborted", () => {
  assert.equal(canTransitionSession("created", "ready"), true);
  assert.equal(canTransitionSession("ready", "aborted"), true);
  assert.equal(canTransitionSession("paused", "running"), true);
  assert.equal(canTransitionSession("completed", "running"), false);
  assert.equal(
    SessionTransitionSchema.safeParse({ from: "ready", to: "completed" })
      .success,
    false,
  );
});

test("validates targeted manual widget runtime commands", () => {
  assert.equal(WidgetRuntimeCommandSchema.safeParse({
    instanceId: "550e8400-e29b-41d4-a716-446655440099",
    action: "highlight",
    bindingValues: { "vehicle.speed": 42 },
  }).success, true);
  assert.equal(WidgetRuntimeCommandSchema.safeParse({
    instanceId: "550e8400-e29b-41d4-a716-446655440099",
    action: "delete",
    bindingValues: {},
  }).success, false);
});

test("uses session terminology in RabbitMQ envelopes", () => {
  const result = MessageEnvelopeSchema.safeParse({
    id: "550e8400-e29b-41d4-a716-446655440002",
    timestamp: "2026-08-24T12:00:00.000Z",
    routingKey: `events.${studyId}.${sessionId}.study.session.started`,
    producer: "core-api",
    payload: { status: "running" },
    metadata: {
      studyId,
      sessionId,
      correlationId: null,
      source: null,
    },
  });

  assert.equal(result.success, true);
  assert.equal(
    MessageEnvelopeSchema.safeParse({
      ...(result.success ? result.data : {}),
      metadata: {
        studyId,
        runId: sessionId,
        correlationId: null,
        source: null,
      },
    }).success,
    false,
  );
});

test("aligns roles and statuses with the refreshed database", () => {
  assert.equal(RoleSchema.safeParse("admin").success, true);
  assert.equal(RoleSchema.safeParse("observer").success, true);
  assert.equal(RoleSchema.safeParse("viewer").success, false);
  assert.equal(StudyStatusSchema.safeParse("configured").success, true);
  assert.equal(StudyStatusSchema.safeParse("active").success, false);

  assert.doesNotThrow(() =>
    ParticipantSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440010",
      studyId,
      participantCode: "P001",
      demographicData: {},
      notes: null,
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    }),
  );
  assert.equal(
    ParticipantSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440010",
      studyId,
      participantCode: "P001",
      assignedConditionId: "550e8400-e29b-41d4-a716-446655440011",
      demographicData: {},
      notes: null,
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    }).success,
    false,
  );

  assert.doesNotThrow(() =>
    SessionConditionSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440012",
      sessionId,
      studyId,
      conditionId: "550e8400-e29b-41d4-a716-446655440011",
      sequence: 0,
      status: "pending",
      startedAt: null,
      completedAt: null,
      configurationSnapshot: {},
      runtimeMetadata: {},
      createdAt: "2026-08-24T12:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z",
    }),
  );
});

test("validates structured study readiness checks", () => {
  const checks = [
    "participants",
    "conditions",
    "simulator",
    "sensors",
    "participant_view",
    "desktop_host",
    "displays",
    "widget_renderer",
    "study_status",
  ].map((key) => ({
    key,
    status: key === "study_status" ? "not_ready" : "ready",
    blocking: key !== "study_status",
    blockingCode: key === "study_status" ? "STUDY_NOT_MARKED_READY" : null,
    message: `${key} readiness`,
    correctionRoute: "/user-studies/00000000-0000-4000-8000-000000000000/overview",
    details: {},
  }));
  assert.equal(StudyReadinessSchema.safeParse({
    studyId: "00000000-0000-4000-8000-000000000000",
    ready: true,
    checkedAt: new Date().toISOString(),
    checks,
  }).success, true);
});

test("keeps refresh tokens out of JSON and hardens their cookie", () => {
  assert.equal(REFRESH_TOKEN_COOKIE_NAME, "__Host-scarline_refresh");
  assert.deepEqual(REFRESH_TOKEN_COOKIE_OPTIONS, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    priority: "high",
  });
  assert.equal(NewPasswordSchema.safeParse("too-short").success, false);
  assert.equal(
    LoginRequestSchema.safeParse({ username: "researcher", password: "x" })
      .success,
    true,
  );

  const response = {
    accessToken: "access-token",
    accessTokenExpiresAt: "2026-08-24T12:15:00.000Z",
    user: {
      id: "550e8400-e29b-41d4-a716-446655440020",
      username: "researcher",
      displayName: "Researcher",
      passwordResetRequired: false,
      roles: ["researcher"],
    },
  };
  assert.equal(AccessTokenResponseSchema.safeParse(response).success, true);
  assert.equal(
    AccessTokenResponseSchema.safeParse({
      ...response,
      refreshToken: "must-not-be-in-json",
    }).success,
    false,
  );
});

test("separates single-use browser WebSocket tickets from access tokens", () => {
  const ticketClaims = {
    iss: "scarline-core-api",
    aud: "scarline-user-websocket",
    sub: "550e8400-e29b-41d4-a716-446655440020",
    jti: "550e8400-e29b-41d4-a716-446655440021",
    authSessionId: "550e8400-e29b-41d4-a716-446655440022",
    tokenType: "user-websocket-ticket",
    iat: 1_785_000_000,
    exp: 1_785_000_030,
  };
  assert.equal(UserWebSocketTicketClaimsSchema.safeParse(ticketClaims).success, true);
  assert.equal(UserWebSocketTicketClaimsSchema.safeParse({
    ...ticketClaims,
    aud: "scarline-admin-panel",
  }).success, false);
  assert.equal(UserWebSocketTicketResponseSchema.safeParse({
    token: "single-use-ticket",
    expiresAt: "2026-08-24T12:00:30.000Z",
  }).success, true);
  assert.equal(UserWebSocketTicketHeadersSchema.safeParse({
    "sec-websocket-protocol": "scarline.user-ticket.single-use-ticket",
  }).success, true);
  assert.equal(UserWebSocketTicketHeadersSchema.safeParse({
    authorization: "Bearer access-token",
  }).success, false);
});

test("uses a separate hardened cookie and strict contracts for overlay renderers", () => {
  assert.equal(OVERLAY_RENDER_COOKIE_NAME, "__Host-scarline_overlay");
  assert.deepEqual(OVERLAY_RENDER_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE_OPTIONS);
  const layoutId = "550e8400-e29b-41d4-a716-446655440030";
  const instanceId = "550e8400-e29b-41d4-a716-446655440031";
  assert.doesNotThrow(() => OverlayHostCommandSchema.parse({
    type: "overlay.window.open",
    commandId: "550e8400-e29b-41d4-a716-446655440090",
    hostId: "lab-mac-01",
    issuedAt: "2026-08-24T12:00:00.000Z",
    window: {
      instanceId,
      targetDisplay: "primary",
      windowMode: "transparent_electron",
      inputMode: "click_through",
      coordinateSpace: "display-relative",
      x: 10, y: 20, width: 300, height: 200,
      widgetKey: "speedometer",
      rendererUrl: `http://localhost:4000/widget/${instanceId}#bootstrap=credential`,
    },
  }));
  assert.doesNotThrow(() => OverlayHostEventSchema.parse({
    type: "overlay.status",
    hostId: "lab-mac-01",
    occurredAt: "2026-08-24T12:00:01.000Z",
    ready: true,
    displays: [],
    windows: [{
      instanceId,
      targetDisplay: "participant-display",
      liveDisplay: "primary",
      degraded: true,
      degradedReason: "Assigned display participant-display is unavailable.",
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    }],
  }));
  assert.doesNotThrow(() => OverlayRuntimeSnapshotSchema.parse({
    scope: {
      rendererMode: "browser",
      studyId,
      sessionId: null,
      conditionId: "550e8400-e29b-41d4-a716-446655440011",
      layoutId,
      instanceId: null,
    },
    layout: { id: layoutId, name: "Participant", targetDisplay: "primary" },
    displays: [{
      id: "display-1",
      index: 0,
      name: "Primary",
      primary: true,
      scaleFactor: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }],
    widgets: [],
  }));
});

test("uses Sim-Bridge as the RabbitMQ publisher for CARLA data", () => {
  const envelope = {
    id: "550e8400-e29b-41d4-a716-446655440021",
    timestamp: "2026-08-24T12:00:00.000Z",
    routingKey: `events.${studyId}.${sessionId}.driving.vehicle.telemetry`,
    producer: "sim-bridge",
    payload: { speed: 10 },
    metadata: {
      studyId,
      sessionId,
      correlationId: null,
      source: { component: "carla-client", instanceId: "primary" },
    },
  };

  assert.equal(MessageEnvelopeSchema.safeParse(envelope).success, true);
  assert.equal(
    MessageEnvelopeSchema.safeParse({
      ...envelope,
      producer: "carla-client",
    }).success,
    false,
  );
});

test("does not expose the removed process manager as a component", () => {
  assert.equal(ComponentIdSchema.safeParse("desktop-overlay").success, true);
  assert.equal(ComponentIdSchema.safeParse("process-manager").success, false);
});

test("validates typed CoreAPI WebSocket messages", () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440022";
  assert.doesNotThrow(() =>
    WebSocketClientMessageSchema.parse({
      type: "subscription.subscribe",
      requestId,
      channels: ["session.lifecycle", "system.health"],
      filters: { studyId, sessionId },
    }),
  );
  assert.doesNotThrow(() =>
    WebSocketServerMessageSchema.parse({
      type: "subscription.ack",
      requestId,
      action: "subscribe",
      channels: ["session.lifecycle", "system.health"],
    }),
  );
  assert.doesNotThrow(() =>
    WebSocketServerMessageSchema.parse({
      type: "data",
      channel: "session.lifecycle",
      timestamp: "2026-08-24T12:00:00.000Z",
      data: {
        studyId,
        sessionId,
        previousStatus: "ready",
        status: "running",
        commandId: requestId,
        commandAction: "start",
        commandStatus: "completed",
        commandError: null,
        activeConditionId: "550e8400-e29b-41d4-a716-446655440023",
        activeConditionName: "Baseline",
        activeConditionSequence: 0,
        conditionCount: 2,
        remainingConditionCount: 1,
      },
    }),
  );
  assert.equal(
    WebSocketServerMessageSchema.safeParse({
      type: "data",
      channel: "session.lifecycle",
      timestamp: "2026-08-24T12:00:00.000Z",
      data: { arbitrary: true },
    }).success,
    false,
  );
});

test("validates explicit overlay runtime close messages", () => {
  assert.doesNotThrow(() => OverlayRuntimeServerMessageSchema.parse({
    type: "overlay.runtime.close",
    reason: "session-terminal",
  }));
  assert.equal(OverlayRuntimeServerMessageSchema.safeParse({
    type: "overlay.runtime.close",
    reason: "unknown",
  }).success, false);
});

test("keeps WebSocket access tokens out of request URLs", () => {
  assert.equal(
    WebSocketAuthHeadersSchema.safeParse({
      "sec-websocket-protocol": "scarline, scarline.access-token.jwt-value",
    }).success,
    true,
  );
  assert.equal(WebSocketAuthHeadersSchema.safeParse({}).success, false);
});

test("preserves both old widget metadata inputs and normalizes them", () => {
  const legacy = WidgetMetadataSchema.parse({
    id: "speedometer",
    name: "Speedometer",
    description: "Vehicle speed",
    version: "1.0.0",
    category: "driving",
    bindings: [
      { key: "vehicle.speed", type: "number", unit: "km/h" },
    ],
    triggers: [{ action: "highlight", description: "Highlight widget" }],
    ui: {
      minWidth: 160,
      minHeight: 120,
      preferredWidth: 300,
      preferredHeight: 220,
    },
  });
  const modern = WidgetMetadataSchema.parse({
    id: "speedometer",
    name: "Speedometer",
    description: "Vehicle speed",
    version: "1.0.0",
    category: "driving",
    bindings: {
      "vehicle.speed": { type: "number", unit: "km/h" },
    },
    actions: { highlight: { description: "Highlight widget" } },
    ui: {
      minSize: { w: 160, h: 120 },
      preferredSize: { w: 300, h: 220 },
    },
  });

  assert.deepEqual(modern, legacy);
});

test("requires dedicated per-widget display targeting", () => {
  const layout = {
    id: "550e8400-e29b-41d4-a716-446655440030",
    conditionId: "550e8400-e29b-41d4-a716-446655440011",
    name: "Participant",
    type: "participant",
    targetDisplay: "primary",
    layoutConfig: {},
    revision: 1,
    widgets: [
      {
        id: "550e8400-e29b-41d4-a716-446655440031",
        layoutId: "550e8400-e29b-41d4-a716-446655440030",
        widgetId: "550e8400-e29b-41d4-a716-446655440032",
        windowMode: "transparent_electron",
        inputMode: "click_through",
        targetDisplay: "secondary",
        order: 0,
        x: 20,
        y: 30,
        width: 300,
        height: 220,
        enabled: true,
        configuration: {},
        bindingsConfig: {},
        styleOverrides: {},
        createdAt: "2026-08-24T12:00:00.000Z",
        updatedAt: "2026-08-24T12:00:00.000Z",
      },
    ],
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:00.000Z",
  };

  assert.equal(LayoutSchema.safeParse(layout).success, true);
  const { targetDisplay: _targetDisplay, ...widgetWithoutDisplay } =
    layout.widgets[0]!;
  assert.equal(
    LayoutSchema.safeParse({
      ...layout,
      widgets: [widgetWithoutDisplay],
    }).success,
    false,
  );
});

test("validates atomic participant layout saves with expected revisions", () => {
  const result = ParticipantLayoutBulkSaveSchema.safeParse({
    name: "Participant",
    targetDisplay: "primary",
    layoutConfig: {},
    expectedRevisions: [{
      conditionId: "550e8400-e29b-41d4-a716-446655440011",
      layoutId: "550e8400-e29b-41d4-a716-446655440030",
      revision: 2,
    }],
    widgets: [{
      widgetId: "550e8400-e29b-41d4-a716-446655440032",
      windowMode: "transparent_electron",
      inputMode: "click_through",
      targetDisplay: "primary",
      order: 0,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      enabled: true,
      configuration: {},
      bindingsConfig: {},
      styleOverrides: {},
    }],
  });
  assert.equal(result.success, true);
  assert.equal(ParticipantLayoutBulkSaveSchema.safeParse({
    ...(result.success ? result.data : {}),
    expectedRevisions: [],
  }).success, false);
});

test("validates complete active-session window saves", () => {
  const input = {
    expectedRevision: 3,
    windowMode: "transparent_electron",
    inputMode: "click_through",
    targetDisplay: "display-2",
    order: 0,
    x: 12,
    y: 24,
    width: 320,
    height: 180,
    enabled: true,
    configuration: { label: "Speed" },
    bindingsConfig: { value: "vehicle.speed" },
    styleOverrides: {},
  };
  assert.equal(SessionParticipantWindowSaveSchema.safeParse(input).success, true);
  assert.equal(SessionParticipantWindowSaveSchema.safeParse({
    ...input,
    expectedRevision: 0,
  }).success, false);
  assert.equal(SessionParticipantWindowSaveSchema.safeParse({
    ...input,
    targetDisplay: "",
  }).success, false);
});

test("validates scoped degraded-window status updates", () => {
  assert.equal(OverlayWindowStatusPayloadSchema.safeParse({
    type: "overlay.window.status",
    hostId: "lab-host",
    occurredAt: "2026-08-24T12:00:00.000Z",
    instanceId: "550e8400-e29b-41d4-a716-446655440031",
    targetDisplay: "display-2",
    liveDisplay: "display-1",
    degraded: true,
    degradedReason: "Assigned display display-2 is unavailable.",
    bounds: { x: 10, y: 20, width: 300, height: 200 },
  }).success, true);
});

test("keeps CLI process ownership separate from overlay control", () => {
  assert.doesNotThrow(() =>
    OverlayControlMessageSchema.parse({
      type: "overlay.window.open",
      window: {
        instanceId: "550e8400-e29b-41d4-a716-446655440031",
        targetDisplay: "secondary",
        windowMode: "transparent_electron",
        coordinateSpace: "display-relative",
        x: 20,
        y: 30,
        width: 300,
        height: 220,
      },
    }),
  );
  assert.equal(
    OverlayControlMessageSchema.safeParse({
      type: "overlay.process.start",
    }).success,
    false,
  );
});

test("validates typed sensor payloads", () => {
  assert.doesNotThrow(() =>
    BlinkEventPayloadSchema.parse({
      earLeft: 0.25,
      earRight: 0.24,
      earAverage: 0.245,
      blinkDetected: true,
      blinkCount: 3,
      eyesClosed: false,
      connected: true,
    }),
  );
  assert.equal(
    BlinkEventPayloadSchema.safeParse({
      blinkDetected: true,
      connected: true,
    }).success,
    false,
  );
});

test("validates command and event routing keys", () => {
  assert.equal(CommandRoutingKeySchema.safeParse("commands.session.start").success, true);
  assert.equal(
    EventRoutingKeySchema.safeParse(
      `events.${studyId}.${sessionId}.driving.vehicle.telemetry`,
    ).success,
    true,
  );
  assert.equal(CommandRoutingKeySchema.safeParse("events.session.started").success, false);
});

test("validates simulator session binding and normalized telemetry", () => {
  const commandId = "550e8400-e29b-41d4-a716-446655440099";
  const sessionConditionId = "550e8400-e29b-41d4-a716-446655440098";
  assert.doesNotThrow(() =>
    AdapterBindSessionMessageSchema.parse({
      version: 1,
      id: "550e8400-e29b-41d4-a716-446655440097",
      timestamp: "2026-08-24T12:00:00.000Z",
      type: "adapter.bind_session",
      commandId,
      studyId,
      sessionId,
      sessionConditionId,
      sequence: 0,
      simulatorType: "mock",
      configuration: { map: "Town03" },
      deadlineAt: "2026-08-24T12:00:30.000Z",
    }),
  );
  assert.doesNotThrow(() =>
    VehicleTelemetryMessageSchema.parse({
      version: 1,
      id: "550e8400-e29b-41d4-a716-446655440096",
      timestamp: "2026-08-24T12:00:00.000Z",
      type: "vehicle.telemetry",
      speed: 45.2,
      throttle: 0.6,
      steer: -0.01,
      brake: 0,
    }),
  );
  assert.throws(() =>
    VehicleTelemetryMessageSchema.parse({
      version: 1,
      id: "550e8400-e29b-41d4-a716-446655440095",
      timestamp: "2026-08-24T12:00:00.000Z",
      type: "vehicle.telemetry",
      speed: 45.2,
      throttle: 1.2,
      steer: 0,
      brake: 0,
    }),
  );
  assert.doesNotThrow(() => SimBridgeLifecycleCommandSchema.parse({
    commandId,
    action: "start",
    sessionId,
    deadlineAt: "2026-08-24T12:00:30.000Z",
    configuration: {
      studyId,
      sessionId,
      sessionConditionId,
      sequence: 0,
      simulatorType: "mock",
      configuration: { seed: 1 },
    },
  }));
  assert.equal(SimBridgeLifecycleCommandSchema.safeParse({
    commandId,
    action: "start",
    sessionId,
    deadlineAt: "2026-08-24T12:00:30.000Z",
  }).success, false);
});

test("validates CARLA configuration and real-time vehicle control", () => {
  const sessionConditionId = "550e8400-e29b-41d4-a716-446655440098";
  assert.doesNotThrow(() => CarlaSessionConfigurationSchema.parse({
    map: "Town03",
    weatherPreset: "ClearNoon",
    weatherCustom: { cloudiness: 0, precipitation: 0, windIntensity: 0 },
    egoVehicleBlueprint: "vehicle.lincoln.mkz_2020",
    simulationMode: "synchronous",
    fixedDeltaSeconds: 0.05,
    controlMode: "io",
    randomSeed: 42,
    trafficConfig: { npcVehicleCount: 10, speedDifference: 0, speedLimitOverride: 50 },
    pedestrianConfig: { pedestrianCount: 5 },
    sunConfig: { sunAltitudeAngle: 45 },
    spectatorConfig: { enabled: true, x: -6, y: 0, z: 4, pitch: -15, yaw: 0, roll: 0 },
    recordingConfig: { enabled: true, directory: "condition-a" },
    sensors: [{
      type: "sensor.other.gnss", id: "gnss", attributes: {},
      transform: { x: 0, y: 0, z: 2.2 },
    }],
  }));
  assert.equal(CarlaSessionConfigurationSchema.safeParse({
    map: "Town03", simulationMode: "asynchronous", fixedDeltaSeconds: 0.1,
  }).success, false);
  assert.doesNotThrow(() => RealtimeVehicleControlSchema.parse({
    version: 1,
    id: "550e8400-e29b-41d4-a716-446655440094",
    timestamp: "2026-08-24T12:00:00.000Z",
    type: "vehicle.control",
    studyId,
    sessionId,
    sessionConditionId,
    sourceKey: "driver:logitech_g29",
    sequence: 1,
    throttle: 0.5,
    steer: -0.1,
    brake: 0,
  }));
});

test("validates trigger comparisons between two event paths", () => {
  assert.doesNotThrow(() => TriggerExpressionSchema.parse({
    operator: "gt",
    path: "payload.vehicle.speed",
    valuePath: "payload.vehicle.speedLimit",
  }));
  assert.equal(TriggerExpressionSchema.safeParse({
    operator: "in",
    path: "payload.mode",
    valuePath: "payload.allowedModes",
  }).success, false);
});

test("validates cross-session event pagination and aggregate counts", () => {
  const query = SessionEventAggregateQuerySchema.parse({ limit: "50", modality: "simulator" });
  assert.equal(query.limit, 50);
  assert.doesNotThrow(() => SessionEventAggregateResponseSchema.parse({
    items: [{
      id: "42",
      messageId: null,
      studyId,
      studyName: "Study",
      studyStatus: "running",
      sessionId,
      sessionName: "Session",
      sessionConditionId: null,
      timestamp: "2026-09-01T10:00:00.000Z",
      eventType: "vehicle.telemetry",
      modality: "simulator",
      sourceType: "simulator",
      sourceId: null,
      sourceKey: "mock-primary",
      routingKey: "events.study.session.vehicle.telemetry",
      schemaVersion: "1.0",
      payload: { speed: 0 },
    }],
    nextCursor: "cursor",
    aggregates: {
      activeStudyCount: 0,
      sessionCount: 1,
      eventCount: 1,
      storedPayloadBytes: 16,
    },
  }));
});

import { randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";
import WebSocket from "ws";

import { hashPassword } from "../dist/security/password.js";

const repositoryRoot = new URL("../../../", import.meta.url);
const environmentFile = process.env.SCARLINE_SMOKE_ENV_PATH
  ? pathToFileURL(path.resolve(process.env.SCARLINE_SMOKE_ENV_PATH))
  : new URL(".env", repositoryRoot);
const exportsDirectory = process.env.SCARLINE_SMOKE_EXPORT_DIRECTORY
  ? path.resolve(process.env.SCARLINE_SMOKE_EXPORT_DIRECTORY)
  : new URL(".runtime/exports/", repositoryRoot);
const environment = Object.fromEntries(
  (await readFile(environmentFile, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const pool = new pg.Pool({
  host: process.env.SCARLINE_SMOKE_POSTGRES_HOST ?? "127.0.0.1",
  port: Number(process.env.SCARLINE_SMOKE_POSTGRES_PORT ?? "5432"),
  database: "scarline",
  user: "scarline",
  password: environment.POSTGRES_PASSWORD,
});
const origin = process.env.SCARLINE_SMOKE_ORIGIN ?? "http://localhost:5173";
const baseUrl = process.env.SCARLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:8088";
const adminBaseUrl = process.env.SCARLINE_SMOKE_ADMIN_BASE_URL ?? "http://localhost:5173/admin";
const websocketBaseUrl = baseUrl.replace(/^http/, "ws");
const skipLifecycle = process.env.SCARLINE_SMOKE_SKIP_LIFECYCLE === "true";
const verified = [];
let smokeAdminId;
let studyId;
let sessionId;
let queuedConfigurationSessionId;
let testUserId;
let exportPath;
let overlaySocket;
let sessionSocket;
let token;
const lifecycleOverlayCommands = [];

async function request(method, url, token, body) {
  const headers = { origin };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { response, value };
}

async function adminRequest(method, url, token, body, contentType = "application/json") {
  const response = await fetch(`${adminBaseUrl}${url}`, {
    method,
    headers: {
      origin: new URL(adminBaseUrl).origin,
      cookie: `scarline_access_token=${token}`,
      "content-type": contentType,
    },
    body: contentType === "application/json" ? JSON.stringify(body) : body.toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return { response, text };
}

async function waitForCommand(token, id) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const command = (await request("GET", `/api/v1/session-commands/${id}`, token)).value.data;
    if (["completed", "failed", "timed_out"].includes(command.status)) return command;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Lifecycle command polling timed out");
}

async function waitForMockAdapter(token) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const components = (await request("GET", "/api/v1/components/status", token)).value.data;
    if (components.some((component) =>
      component.component === "sim-bridge"
      && component.available === true
      && component.adapters.includes("mock"),
    )) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock Simulator did not register with Sim Bridge");
}

async function openSocket(url, protocols, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      reject(new Error(`WebSocket upgrade returned ${response.statusCode}`));
    });
  });
}

async function nextSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
  });
}

async function waitForSocketMessage(socket, predicate, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for the expected WebSocket message"));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

try {
  const smokeUsername = `smoke-admin-${randomBytes(4).toString("hex")}`;
  const initialPassword = `I-${randomBytes(24).toString("base64url")}`;
  const smokeAdmin = (await pool.query(
    `INSERT INTO users(username,password_hash,display_name,password_reset_required)
     VALUES($1,$2,$3,TRUE) RETURNING id`,
    [smokeUsername, await hashPassword(initialPassword), "CoreAPI Smoke Administrator"],
  )).rows[0];
  smokeAdminId = smokeAdmin.id;
  await pool.query(
    `INSERT INTO user_roles(user_id,role_id)
     SELECT $1,id FROM roles WHERE name='admin'`,
    [smokeAdminId],
  );
  const login = await request("POST", "/api/v1/auth/login", null, {
    username: smokeUsername,
    password: initialPassword,
  });
  const cookie = login.response.headers.get("set-cookie") ?? "";
  if (!["HttpOnly", "Secure", "SameSite=Strict"].every((attribute) => cookie.includes(attribute))) {
    throw new Error("Refresh cookie is not hardened");
  }
  const strongPassword = `S-${randomBytes(24).toString("base64url")}`;
  await request("POST", "/api/v1/auth/change-password", login.value.data.accessToken, {
    currentPassword: initialPassword,
    newPassword: strongPassword,
  });
  const activeLogin = await request("POST", "/api/v1/auth/login", null, { username: smokeUsername, password: strongPassword });
  token = activeLogin.value.data.accessToken;
  verified.push("auth-cookie-password-reset");

  const websocketTicket = (await request(
    "POST",
    "/api/v1/auth/websocket-ticket",
    token,
    {},
  )).value.data.token;
  const userSocket = await openSocket(
    `${websocketBaseUrl}/ws`,
    [`scarline.user-ticket.${websocketTicket}`],
  );
  const subscriptionMessage = nextSocketMessage(userSocket);
  userSocket.send(JSON.stringify({
    type: "subscription.subscribe",
    requestId: randomUUID(),
    channels: ["system.health"],
  }));
  if ((await subscriptionMessage).type !== "subscription.ack") throw new Error("User WebSocket subscription was not acknowledged");
  userSocket.close();
  let replayRejected = false;
  try {
    const replayed = await openSocket(
      `${websocketBaseUrl}/ws`,
      [`scarline.user-ticket.${websocketTicket}`],
    );
    replayed.close();
  } catch {
    replayRejected = true;
  }
  if (!replayRejected) throw new Error("Consumed WebSocket ticket was accepted twice");

  const overlayTokenResponse = await fetch(`${baseUrl}/api/v1/overlay/token`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-overlay-control-secret": environment.OVERLAY_CONTROL_SECRET },
    body: "{}",
  });
  if (!overlayTokenResponse.ok) throw new Error(`Overlay token exchange returned ${overlayTokenResponse.status}`);
  const overlayToken = (await overlayTokenResponse.json()).data.token;
  overlaySocket = await openSocket(`${websocketBaseUrl}/overlay-control`, undefined, {
    headers: { authorization: `Bearer ${overlayToken}` },
  });
  const overlayHostId = `smoke-host-${randomBytes(4).toString("hex")}`;
  overlaySocket.send(JSON.stringify({
    type: "overlay.status",
    hostId: overlayHostId,
    occurredAt: new Date().toISOString(),
    displays: [{
      id: "primary",
      index: 0,
      name: "Playwright Display",
      primary: true,
      scaleFactor: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }],
    windows: [],
    ready: true,
  }));
  const overlayStatus = (await request("GET", "/api/v1/overlay/status", token)).value.data;
  if (
    overlayStatus.connected !== true
    || !overlayStatus.hosts.some((host) => host.hostId === overlayHostId && host.connected === true)
  ) throw new Error("Overlay control host was not registered");
  const commandMessage = nextSocketMessage(overlaySocket);
  const overlayCommandRequest = request("POST", "/api/v1/overlay/commands", token, {
    type: "overlay.window.close",
    hostId: overlayHostId,
    instanceId: randomUUID(),
  });
  const issuedCommand = await commandMessage;
  if (issuedCommand.hostId !== overlayHostId || typeof issuedCommand.commandId !== "string") {
    throw new Error("Overlay command was not targeted to the selected host");
  }
  overlaySocket.send(JSON.stringify({
    type: "overlay.command.result",
    hostId: overlayHostId,
    occurredAt: new Date().toISOString(),
    commandId: issuedCommand.commandId,
    accepted: true,
    error: null,
  }));
  const overlayCommand = await overlayCommandRequest;
  if (
    overlayCommand.response.status !== 200
    || overlayCommand.value.data.commandId !== issuedCommand.commandId
    || overlayCommand.value.data.hostId !== overlayHostId
  ) throw new Error("Overlay command acknowledgement was not correlated");
  overlaySocket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (typeof message.commandId !== "string" || typeof message.type !== "string") return;
    lifecycleOverlayCommands.push(message);
    overlaySocket?.send(JSON.stringify({
      type: "overlay.command.result",
      hostId: overlayHostId,
      occurredAt: new Date().toISOString(),
      commandId: message.commandId,
      accepted: true,
      error: null,
    }));
  });
  verified.push("websocket-overlay-trust-boundaries");

  const username = `operator-${randomBytes(4).toString("hex")}`;
  const temporaryPassword = `T-${randomBytes(24).toString("base64url")}`;
  const operatorPassword = `O-${randomBytes(24).toString("base64url")}`;
  const createdUser = (await request("POST", "/api/v1/users", token, {
    username,
    password: temporaryPassword,
    displayName: "Integration Operator",
    email: null,
    institution: null,
    roles: ["operator"],
  })).value.data;
  testUserId = createdUser.id;
  const operatorInitial = (await request("POST", "/api/v1/auth/login", null, { username, password: temporaryPassword })).value.data.accessToken;
  await request("POST", "/api/v1/auth/change-password", operatorInitial, { currentPassword: temporaryPassword, newPassword: operatorPassword });
  const operatorToken = (await request("POST", "/api/v1/auth/login", null, { username, password: operatorPassword })).value.data.accessToken;
  verified.push("user-rbac");

  const study = (await request("POST", "/api/v1/studies", token, {
    name: `CoreAPI integration ${randomUUID()}`,
    description: null,
    version: "1.0",
    metadata: { test: true },
  })).value.data;
  studyId = study.id;
  const participant = (await request("POST", `/api/v1/studies/${studyId}/participants`, token, {
    participantCode: "P-TEST",
    demographicData: { ageRange: "test" },
    notes: null,
  })).value.data;
  const condition = (await request("POST", `/api/v1/studies/${studyId}/conditions`, token, {
    name: "Mock condition",
    description: null,
    order: 0,
    metadata: {},
  })).value.data;
  await request("PUT", `/api/v1/studies/${studyId}/conditions/${condition.id}/simulator`, token, {
    simulatorType: "mock",
    configuration: { seed: 1 },
  });
  const clonedCondition = (await request("POST", `/api/v1/studies/${studyId}/conditions`, token, {
    name: "Cloned condition",
    description: null,
    order: 1,
    metadata: {},
    templateConditionId: condition.id,
  })).value.data;
  const clonedSimulator = (await request("GET", `/api/v1/studies/${studyId}/conditions/${clonedCondition.id}/simulator`, token)).value.data;
  if (clonedSimulator.simulatorType !== "mock" || clonedSimulator.configuration.seed !== 1) {
    throw new Error("Condition configuration template was not cloned");
  }
  verified.push("condition-configuration-clone");

  await request("POST", "/api/v1/widgets/refresh", token, {});
  const widget = (await request("GET", "/api/v1/widgets/catalogue", token)).value.data[0];
  if (!widget?.databaseId) throw new Error("No active widget was available for the readiness fixture");
  const participantLayout = (await request(
    "POST",
    `/api/v1/studies/${studyId}/conditions/${condition.id}/layouts`,
    token,
    { name: "Participant", type: "participant", targetDisplay: "primary", layoutConfig: {} },
  )).value.data;
  await request(
    "POST",
    `/api/v1/studies/${studyId}/conditions/${condition.id}/layouts/${participantLayout.id}/widgets`,
    token,
    {
      widgetId: widget.databaseId,
      windowMode: "transparent_electron",
      targetDisplay: "primary",
      order: 0,
      x: 0,
      y: 0,
      width: 180,
      height: 180,
      enabled: true,
      configuration: {},
      bindingsConfig: {},
      styleOverrides: {},
    },
  );
  await request("POST", `/api/v1/studies/${studyId}/transition`, token, { to: "configured" });
  const queuedConfigurationSession = (await request("POST", `/api/v1/studies/${studyId}/sessions`, token, {
    participantId: participant.id,
    name: "Queued configuration check",
    conditionIds: [condition.id],
    runtimeMetadata: { test: true },
    notes: null,
  })).value.data;
  queuedConfigurationSessionId = queuedConfigurationSession.id;
  await request("POST", `/api/v1/studies/${studyId}/transition`, token, { to: "draft" });
  const simulatorForm = new URLSearchParams({
    map: "Town03",
    weatherPreset: "ClearNoon",
    vehicle: "vehicle.tesla.model3",
    npcVehicleCount: "15",
    pedestrianCount: "0",
    trafficSpeedDifference: "0",
    sunAltitudeAngle: "45",
    cloudiness: "0",
    precipitation: "0",
    windIntensity: "0",
    controlMode: "io",
    randomSeed: "0",
    fixedDeltaSeconds: "0.05",
  });
  const simulatorSave = await adminRequest(
    "POST",
    `/user-studies/${studyId}/carla-config?/saveSimulator`,
    token,
    simulatorForm,
    "application/x-www-form-urlencoded",
  );
  if (!simulatorSave.text.includes("Simulator configuration saved.")) {
    throw new Error("Simulator Setup did not return its saved confirmation");
  }
  await request("POST", `/api/v1/studies/${studyId}/transition`, token, { to: "configured" });
  verified.push("queued-session-study-configuration");
  await adminRequest("POST", `/api/studies/${studyId}/layouts`, token, {
    name: "Participant",
    type: "participant",
    targetDisplay: "primary",
    widgets: [{
      id: randomUUID(),
      widgetId: widget.id,
      windowMode: "transparent_electron",
      targetDisplay: "primary",
      order: 0,
      x: 0,
      y: 0,
      width: 180,
      height: 180,
      bindingsConfig: {},
      triggerRules: [],
      styleOverrides: {},
    }],
  });
  const savedLayouts = (await request(
    "GET",
    `/api/v1/studies/${studyId}/conditions/${condition.id}/layouts`,
    token,
  )).value.data;
  const savedParticipantLayout = savedLayouts.find((layout) => layout.type === "participant");
  if (!savedParticipantLayout || savedParticipantLayout.revision < 2) {
    throw new Error("Transactional participant layout save did not advance its revision");
  }
  const staleLayoutSave = await fetch(`${baseUrl}/api/v1/studies/${studyId}/layouts/participant`, {
    method: "PUT",
    headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Participant",
      targetDisplay: "primary",
      layoutConfig: {},
      expectedRevisions: [{
        conditionId: condition.id,
        layoutId: savedParticipantLayout.id,
        revision: savedParticipantLayout.revision - 1,
      }],
      widgets: [{
        widgetId: widget.databaseId,
        windowMode: "transparent_electron",
        inputMode: "click_through",
        targetDisplay: "primary",
        order: 0,
        x: 0,
        y: 0,
        width: 180,
        height: 180,
        enabled: true,
        configuration: {},
        bindingsConfig: {},
        styleOverrides: {},
      }],
    }),
  });
  const staleLayoutBody = await staleLayoutSave.json();
  if (staleLayoutSave.status !== 409 || staleLayoutBody.error?.code !== "LAYOUT_VERSION_CONFLICT") {
    throw new Error("Stale participant layout revision was not rejected deterministically");
  }
  verified.push("transactional-layout-save-version-conflict");
  const queuedMockSimulator = (await request(
    "GET",
    `/api/v1/studies/${studyId}/conditions/${condition.id}/simulator`,
    token,
  )).value.data;
  const queuedStudy = (await request("GET", `/api/v1/studies/${studyId}`, token)).value.data;
  if (
    queuedMockSimulator.simulatorType !== "mock"
    || queuedMockSimulator.configuration.seed !== 1
    || queuedStudy.metadata.configurationTemplates?.simulator?.map !== "Town03"
  ) {
    throw new Error("Simulator defaults were not saved independently of the active Mock configuration");
  }
  await request("DELETE", `/api/v1/sessions/${queuedConfigurationSessionId}`, token);
  queuedConfigurationSessionId = undefined;
  verified.push("admin-saves-with-queued-mock-session");
  await waitForMockAdapter(token);
  const readiness = (await request("GET", `/api/v1/studies/${studyId}/readiness`, token)).value.data;
  if (readiness.ready !== true || readiness.checks.length !== 9) {
    throw new Error(`Structured study readiness did not accept the complete fixture: ${JSON.stringify(readiness)}`);
  }
  verified.push("study-readiness");
  await request("POST", `/api/v1/studies/${studyId}/transition`, token, { to: "ready" });
  await request("POST", `/api/v1/studies/${studyId}/users`, token, { userId: testUserId });
  const session = (await request("POST", `/api/v1/studies/${studyId}/sessions`, token, {
    participantId: participant.id,
    name: "Integration session",
    conditionIds: [condition.id, clonedCondition.id],
    runtimeMetadata: { test: true },
    notes: null,
  })).value.data;
  sessionId = session.id;
  if (
    session.conditions.length !== 2
    || session.conditions[0]?.conditionId !== condition.id
    || session.conditions[1]?.conditionId !== clonedCondition.id
  ) throw new Error("Ordered session conditions were not preserved");
  verified.push("study-session-crud");

  if (!skipLifecycle) {
    await waitForMockAdapter(token);
    const sessionSocketTicket = (await request(
      "POST",
      "/api/v1/auth/websocket-ticket",
      token,
      {},
    )).value.data.token;
    sessionSocket = await openSocket(
      `${websocketBaseUrl}/ws`,
      [`scarline.user-ticket.${sessionSocketTicket}`],
    );
    const sessionSubscription = nextSocketMessage(sessionSocket);
    sessionSocket.send(JSON.stringify({
      type: "subscription.subscribe",
      requestId: randomUUID(),
      channels: ["session.telemetry"],
      filters: { studyId, sessionId },
    }));
    if ((await sessionSubscription).type !== "subscription.ack") {
      throw new Error("Session telemetry subscription was not acknowledged");
    }

    for (const action of ["ready", "start", "pause", "resume", "advance", "abort"]) {
      const telemetryMessage = action === "start"
        ? waitForSocketMessage(sessionSocket, (message) => message.channel === "session.telemetry")
        : null;
      const body = action === "abort" ? { reason: "Integration smoke test completed" } : {};
      const queued = (await request("POST", `/api/v1/sessions/${sessionId}/${action}`, token, body)).value.data;
      const completed = await waitForCommand(token, queued.commandId);
      if (completed.status !== "completed") throw new Error(`${action} command ${completed.status}: ${completed.errorMessage}`);
      if (action === "start") {
        const telemetry = await telemetryMessage;
        const payload = telemetry?.data?.payload;
        if (
          telemetry?.data?.producer !== "sim-bridge"
          || payload?.modality !== "driving"
          || !Number.isFinite(payload?.speed)
          || !Number.isFinite(payload?.throttle)
          || !Number.isFinite(payload?.steer)
          || !Number.isFinite(payload?.brake)
        ) throw new Error(`Mock telemetry was not delivered through session.telemetry: ${JSON.stringify(telemetry)}`);
        verified.push("mock-session-realtime-telemetry");
        const [liveLayout] = (await request(
          "GET",
          `/api/v1/studies/${studyId}/conditions/${condition.id}/layouts`,
          token,
        )).value.data.filter((layout) => layout.type === "participant");
        const liveWindow = liveLayout?.widgets?.[0];
        if (!liveLayout || !liveWindow) throw new Error("Active participant window was not available for persistence smoke coverage");
        const activeWindowForm = new URLSearchParams({
          sessionId,
          layoutId: liveLayout.id,
          windows: JSON.stringify([{
            instanceId: liveWindow.id,
            expectedRevision: liveLayout.revision,
            mode: liveWindow.windowMode,
            inputMode: liveWindow.inputMode,
            targetDisplay: liveWindow.targetDisplay,
            order: liveWindow.order,
            x: liveWindow.x + 17,
            y: liveWindow.y + 11,
            width: liveWindow.width + 20,
            height: liveWindow.height,
            enabled: liveWindow.enabled,
            configuration: liveWindow.configuration,
            bindingsConfig: liveWindow.bindingsConfig,
            styleOverrides: liveWindow.styleOverrides,
          }]),
        });
        await adminRequest(
          "POST",
          `/user-studies/${studyId}/active-study?/windowUpdate`,
          operatorToken,
          activeWindowForm,
          "application/x-www-form-urlencoded",
        );
        const [persistedLayout] = (await request(
          "GET",
          `/api/v1/studies/${studyId}/conditions/${condition.id}/layouts`,
          token,
        )).value.data.filter((layout) => layout.type === "participant");
        const persistedWindow = persistedLayout.widgets.find((window) => window.id === liveWindow.id);
        if (
          persistedLayout.revision !== liveLayout.revision + 1
          || persistedWindow.x !== liveWindow.x + 17
          || persistedWindow.width !== liveWindow.width + 20
        ) throw new Error("Active Study window change was not persisted with its layout revision");
        verified.push("active-study-window-persistence");
      }
      if (action === "advance") {
        const advanced = (await request("GET", `/api/v1/sessions/${sessionId}`, token)).value.data;
        if (
          advanced.activeCondition?.conditionId !== clonedCondition.id
          || advanced.activeCondition?.sequence !== 1
          || advanced.remainingConditionCount !== 0
          || advanced.conditions[0]?.status !== "completed"
          || advanced.conditions[1]?.status !== "active"
        ) throw new Error("Advance did not activate the next ordered condition consistently");
        verified.push("advance-condition-overlay-switch");
      }
    }
    const finalSession = (await request("GET", `/api/v1/sessions/${sessionId}`, token)).value.data;
    if (
      finalSession.status !== "aborted"
      || finalSession.conditions[0]?.status !== "completed"
      || finalSession.conditions[1]?.status !== "aborted"
    ) {
      throw new Error("Session did not abort consistently");
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (lifecycleOverlayCommands.some((command) => command.type === "overlay.window.close")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const openedInstanceIds = lifecycleOverlayCommands
      .filter((command) => command.type === "overlay.window.open")
      .map((command) => command.window?.instanceId)
      .filter((instanceId) => typeof instanceId === "string");
    const closedInstanceIds = new Set(lifecycleOverlayCommands
      .filter((command) => command.type === "overlay.window.close")
      .map((command) => command.instanceId)
      .filter((instanceId) => typeof instanceId === "string"));
    if (openedInstanceIds.length === 0 || openedInstanceIds.some((instanceId) => !closedInstanceIds.has(instanceId))) {
      throw new Error("Abort did not close every participant widget opened for the session");
    }
    verified.push("abort-closes-participant-widgets");
    verified.push("sim-bridge-lifecycle-snapshots");
  }

  await request("POST", `/api/v1/sessions/${sessionId}/annotations`, token, {
    text: "Integration annotation",
    category: "test",
    sessionConditionId: null,
    metadata: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const events = (await request("GET", `/api/v1/sessions/${sessionId}/events?limit=200`, token)).value.data.items;
  if (
    !events.some((event) => event.routingKey?.includes(".annotation."))
    || (!skipLifecycle && !events.some((event) => event.routingKey?.includes(".lifecycle.")))
  ) {
    throw new Error("Required events were not preserved");
  }
  verified.push("events-annotations");

  const aggregateEvents = (await request(
    "GET",
    `/api/v1/session-events?studyId=${studyId}&sessionId=${sessionId}&limit=1`,
    operatorToken,
  )).value.data;
  if (
    aggregateEvents.items.length !== 1
    || aggregateEvents.aggregates.sessionCount !== 1
    || aggregateEvents.aggregates.eventCount < events.length
    || aggregateEvents.aggregates.activeStudyCount !== 1
    || aggregateEvents.aggregates.storedPayloadBytes <= 0
  ) {
    throw new Error(`Cross-session event aggregates were incorrect: ${JSON.stringify(aggregateEvents)}`);
  }
  verified.push("aggregate-session-events");

  const systemStatus = (await request("GET", "/api/v1/system/status", token)).value.data;
  if (
    systemStatus.bootstrapCompleted !== true
    || systemStatus.configuration.configurationOwner !== "config.yml"
    || systemStatus.configuration.processOwner !== "SCARline CLI"
    || JSON.stringify(systemStatus).match(/JWT_ACCESS_SECRET|POSTGRES_PASSWORD|RABBITMQ_DEFAULT_PASS/)
  ) {
    throw new Error("Read-only system status was incomplete or exposed secret configuration");
  }
  const operatorSystemStatus = await fetch(`${baseUrl}/api/v1/system/status`, {
    headers: { origin, authorization: `Bearer ${operatorToken}` },
  });
  if (operatorSystemStatus.status !== 403) throw new Error(`Operator system status returned ${operatorSystemStatus.status}`);
  verified.push("safe-system-status-rbac");

  const denied = await fetch(`${baseUrl}/api/v1/exports`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ scope: "session", targetId: sessionId, format: "both" }),
  });
  if (denied.status !== 403) throw new Error(`Operator-only export was not denied: ${denied.status}`);
  const exportJob = (await request("POST", "/api/v1/exports", token, {
    scope: "session",
    targetId: sessionId,
    format: "both",
    pseudonymize: true,
    includeDemographics: false,
  })).value.data;
  let job;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    job = (await request("GET", `/api/v1/exports/${exportJob.id}`, token)).value.data;
    if (["completed", "failed"].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (job.status !== "completed") throw new Error(`Export failed: ${job.error_message}`);
  exportPath = job.result_path;
  const download = await fetch(`${baseUrl}/api/v1/exports/${exportJob.id}/download`, {
    headers: { origin, authorization: `Bearer ${token}` },
  });
  const downloadType = download.headers.get("content-type") ?? "";
  const downloadBytes = (await download.arrayBuffer()).byteLength;
  if (!download.ok || !downloadType.startsWith("application/zip") || downloadBytes === 0) {
    throw new Error(`Export download is not a non-empty ZIP archive: status=${download.status}, type=${downloadType}, bytes=${downloadBytes}`);
  }
  verified.push("export-rbac-archive");

  const rotationLogin = await request("POST", "/api/v1/auth/login", null, { username: smokeUsername, password: strongPassword });
  const originalCookie = (rotationLogin.response.headers.get("set-cookie") ?? "").split(";")[0];
  const refresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie: originalCookie },
    body: "{}",
  });
  const refreshBody = await refresh.json();
  if (!refresh.ok || "refreshToken" in refreshBody.data) throw new Error("Refresh rotation exposed a token or failed");
  const replay = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie: originalCookie },
    body: "{}",
  });
  if (replay.status !== 401) throw new Error(`Consumed refresh-token replay returned ${replay.status}`);
  verified.push("refresh-rotation-replay-revocation");

  console.log(JSON.stringify({ ok: true, verified }));
} finally {
  overlaySocket?.close();
  sessionSocket?.close();
  if (sessionId && token && !skipLifecycle) {
    try {
      const session = (await request("GET", `/api/v1/sessions/${sessionId}`, token)).value.data;
      if (!["completed", "aborted", "failed"].includes(session.status)) {
        await waitForMockAdapter(token).catch(() => undefined);
        const queued = (await request("POST", `/api/v1/sessions/${sessionId}/abort`, token, {
          reason: "Integration smoke test cleanup",
        })).value.data;
        const completed = await waitForCommand(token, queued.commandId);
        if (completed.status !== "completed") {
          console.error(`Smoke cleanup abort ${completed.status}: ${completed.errorMessage}`);
        }
      }
    } catch (error) {
      console.error("Smoke cleanup could not abort its session:", error);
    }
  }
  if (studyId) {
    const messageIds = (await pool.query(
      "SELECT id FROM event_outbox WHERE message#>>$1=$2",
      [["metadata", "studyId"], studyId],
    )).rows.map((row) => row.id);
    if (messageIds.length) await pool.query("DELETE FROM message_inbox WHERE message_id=ANY($1::uuid[])", [messageIds]);
    await pool.query("DELETE FROM event_outbox WHERE message#>>$1=$2", [["metadata", "studyId"], studyId]);
    if (sessionId) await pool.query("DELETE FROM sessions WHERE id=$1", [sessionId]);
    if (queuedConfigurationSessionId) await pool.query("DELETE FROM sessions WHERE id=$1", [queuedConfigurationSessionId]);
    await pool.query("DELETE FROM studies WHERE id=$1", [studyId]);
  }
  if (testUserId) {
    await pool.query("DELETE FROM activity_log WHERE entity_id=$1", [testUserId]);
    await pool.query("DELETE FROM users WHERE id=$1", [testUserId]);
  }
  if (smokeAdminId) {
    await pool.query("DELETE FROM activity_log WHERE actor_user_id=$1 OR entity_id=$1", [smokeAdminId]);
    await pool.query("DELETE FROM users WHERE id=$1", [smokeAdminId]);
  }
  if (exportPath) {
    const artifactName = exportPath.split("/").at(-1);
    if (artifactName && /^[0-9a-f-]{36}\.zip$/.test(artifactName)) {
      const artifactPath = exportsDirectory instanceof URL
        ? new URL(artifactName, exportsDirectory)
        : path.join(exportsDirectory, artifactName);
      await unlink(artifactPath).catch(() => undefined);
    }
  }
  await pool.end();
}

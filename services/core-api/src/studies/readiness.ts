import type { Pool, PoolClient } from "pg";
import {
  StudyReadinessSchema,
  type StudyReadiness,
  type StudyReadinessCheck,
} from "@scarline/contracts";

import { ApiProblem } from "../errors.js";
import type { RealtimeHub } from "../realtime/hub.js";

type Queryable = Pick<Pool | PoolClient, "query">;

interface ConditionConfigurationRow {
  id: string;
  name: string;
  simulator_type: string | null;
}

interface RequiredDeviceRow {
  condition_id: string;
  condition_name: string;
  device_id: string;
  device_name: string;
  status: string;
  configured_sensor_count: number;
}

interface ParticipantLayoutRow {
  condition_id: string;
  condition_name: string;
  layout_id: string | null;
  instance_id: string | null;
  target_display: string | null;
  window_mode: string | null;
  widget_active: boolean | null;
}

interface OverlayStatus {
  selectedHostId?: string | null;
  selectionRequired?: boolean;
  hosts?: Array<{
    hostId: string;
    connected: boolean;
    ready: boolean;
    displays: Array<{ id: string; primary?: boolean }>;
  }>;
}

function check(input: Omit<StudyReadinessCheck, "details"> & {
  details?: Record<string, unknown>;
}): StudyReadinessCheck {
  return { ...input, details: input.details ?? {} };
}

export async function loadStudyReadiness(
  database: Queryable,
  realtime: RealtimeHub,
  studyId: string,
): Promise<StudyReadiness> {
  const studyResult = await database.query<{ status: string }>(
    "SELECT status FROM studies WHERE id=$1",
    [studyId],
  );
  const study = studyResult.rows[0];
  if (study === undefined) {
    throw new ApiProblem(404, "STUDY_NOT_FOUND", "Study not found.");
  }

  const [participants, nonterminalSessions, conditionsResult, requiredDevices, layoutResult] =
    await Promise.all([
      database.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM participants WHERE study_id=$1",
        [studyId],
      ),
      database.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM sessions WHERE study_id=$1 AND status IN ('created','ready','running','paused')",
        [studyId],
      ),
      database.query<ConditionConfigurationRow>(
        `SELECT c.id,c.name,sc.simulator_type
           FROM conditions c
           LEFT JOIN simulator_configurations sc ON sc.condition_id=c.id
          WHERE c.study_id=$1 AND c.archived_at IS NULL
          ORDER BY c."order",c.created_at,c.id`,
        [studyId],
      ),
      database.query<RequiredDeviceRow>(
        `SELECT c.id AS condition_id,c.name AS condition_name,d.id AS device_id,d.name AS device_name,d.status,
                COUNT(csc.id) FILTER (WHERE csc.enabled AND ds.is_active)::int AS configured_sensor_count
           FROM conditions c
           JOIN condition_devices cd ON cd.condition_id=c.id AND cd.enabled
           JOIN devices d ON d.id=cd.device_id
           LEFT JOIN condition_sensor_configurations csc ON csc.condition_device_id=cd.id
           LEFT JOIN device_sensors ds ON ds.id=csc.sensor_id
          WHERE c.study_id=$1 AND c.archived_at IS NULL
            AND COALESCE((cd.configuration->>'required')::boolean,FALSE)
          GROUP BY c.id,c.name,d.id,d.name,d.status
          ORDER BY c."order",c.name,d.name`,
        [studyId],
      ),
      database.query<ParticipantLayoutRow>(
        `SELECT c.id AS condition_id,c.name AS condition_name,l.id AS layout_id,
                wi.id AS instance_id,wi.target_display,wi.window_mode,w.is_active AS widget_active
           FROM conditions c
           LEFT JOIN layouts l ON l.condition_id=c.id AND l.type='participant'
           LEFT JOIN widget_instances wi ON wi.layout_id=l.id AND wi.enabled
           LEFT JOIN widgets w ON w.id=wi.widget_id
          WHERE c.study_id=$1 AND c.archived_at IS NULL
          ORDER BY c."order",c.created_at,l.created_at,wi."order",wi.id`,
        [studyId],
      ),
    ]);

  const conditionRows = conditionsResult.rows;
  const conditionCount = conditionRows.length;
  const participantCount = participants.rows[0]?.count ?? 0;
  const missingSimulator = conditionRows.filter((row) => row.simulator_type === null);
  const configuredSimulatorTypes = conditionRows.flatMap((row) =>
    row.simulator_type === null ? [] : [row.simulator_type],
  );
  const missingCapabilities = missingSimulator.length === 0
    ? realtime.missingSimulatorCapabilities(configuredSimulatorTypes)
    : [];

  const unconfiguredDevices = requiredDevices.rows.filter(
    (row) => row.configured_sensor_count === 0,
  );
  const unavailableDevices = requiredDevices.rows.filter(
    (row) => row.status !== "connected",
  );
  const ioAvailable = realtime.isComponentAvailable("io-client");

  const layoutByCondition = new Map<string, ParticipantLayoutRow[]>();
  for (const row of layoutResult.rows) {
    const current = layoutByCondition.get(row.condition_id) ?? [];
    current.push(row);
    layoutByCondition.set(row.condition_id, current);
  }
  const missingLayouts = conditionRows.filter((condition) =>
    !(layoutByCondition.get(condition.id) ?? []).some((row) => row.layout_id !== null),
  );
  const emptyLayouts = conditionRows.filter((condition) => {
    const rows = layoutByCondition.get(condition.id) ?? [];
    return rows.some((row) => row.layout_id !== null)
      && !rows.some((row) => row.instance_id !== null);
  });
  const unresolvedWidgets = layoutResult.rows.filter(
    (row) => row.instance_id !== null && row.widget_active !== true,
  );
  const enabledWidgets = layoutResult.rows.filter(
    (row) => row.instance_id !== null && row.widget_active === true,
  );

  const overlayStatus = realtime.overlayStatus as OverlayStatus;
  const selectedHost = overlayStatus.hosts?.find(
    (host) => host.hostId === overlayStatus.selectedHostId && host.connected,
  ) ?? null;
  const displayIds = new Set(selectedHost?.displays.map(({ id }) => id) ?? []);
  const hasPrimaryDisplay = selectedHost?.displays.some(({ primary }) => primary === true) ?? false;
  const desktopWidgets = enabledWidgets.filter(
    (row) => row.window_mode !== "browser_popup",
  );
  const browserWidgets = enabledWidgets.filter(
    (row) => row.window_mode === "browser_popup",
  );
  const missingDisplayWidgets = desktopWidgets.filter(
    (row) => row.target_display === null
      || (row.target_display !== "primary" && !displayIds.has(row.target_display))
      || (row.target_display === "primary" && !hasPrimaryDisplay),
  );
  const desktopRendererReady = desktopWidgets.length === 0
    || selectedHost?.ready === true;
  const browserRendererReady = browserWidgets.length === 0
    || realtime.hasRendererMode("browser", studyId);

  const base = `/user-studies/${studyId}`;
  const checks: StudyReadinessCheck[] = [
    check({
      key: "participants",
      status: participantCount > 0 ? "ready" : "not_ready",
      blocking: true,
      blockingCode: participantCount > 0 ? null : "PARTICIPANT_REQUIRED",
      message: participantCount > 0
        ? `${participantCount} participant${participantCount === 1 ? " is" : "s are"} available.`
        : "Add at least one participant to this study.",
      correctionRoute: `${base}/participants`,
      details: { participantCount },
    }),
    check({
      key: "conditions",
      status: conditionCount > 0 ? "ready" : "not_ready",
      blocking: true,
      blockingCode: conditionCount > 0 ? null : "CONDITION_REQUIRED",
      message: conditionCount > 0
        ? `${conditionCount} condition${conditionCount === 1 ? " is" : "s are"} configured.`
        : "Configure at least one study condition.",
      correctionRoute: `${base}/conditions`,
      details: { conditionCount },
    }),
    check({
      key: "simulator",
      status: conditionCount > 0 && missingSimulator.length === 0 && missingCapabilities.length === 0
        ? "ready"
        : "not_ready",
      blocking: true,
      blockingCode: conditionCount === 0 || missingSimulator.length > 0
        ? "SIMULATOR_CONFIGURATION_REQUIRED"
        : missingCapabilities.length > 0
          ? "SIMULATOR_UNAVAILABLE"
          : null,
      message: conditionCount === 0 || missingSimulator.length > 0
        ? "Set up the simulator for every active condition."
        : missingCapabilities.length > 0
          ? `The required simulator is unavailable: ${missingCapabilities.join(", ")}.`
          : "The simulator is configured and available.",
      correctionRoute: `${base}/carla-config`,
      details: {
        missingConditionIds: missingSimulator.map(({ id }) => id),
        missingCapabilities,
      },
    }),
    check({
      key: "sensors",
      status: unconfiguredDevices.length === 0
        && unavailableDevices.length === 0
        && (requiredDevices.rows.length === 0 || ioAvailable)
        ? "ready"
        : "not_ready",
      blocking: true,
      blockingCode: unconfiguredDevices.length > 0
        ? "REQUIRED_SENSOR_CONFIGURATION_MISSING"
        : unavailableDevices.length > 0 || (requiredDevices.rows.length > 0 && !ioAvailable)
          ? "REQUIRED_SENSOR_UNAVAILABLE"
          : null,
      message: unconfiguredDevices.length > 0
        ? "Configure every required sensor before marking the study ready."
        : unavailableDevices.length > 0 || (requiredDevices.rows.length > 0 && !ioAvailable)
          ? "Connect the required sensor devices and IO client."
          : requiredDevices.rows.length === 0
            ? "No required external sensors are configured."
            : "All required sensors are configured and available.",
      correctionRoute: `${base}/sensors`,
      details: {
        requiredDeviceCount: requiredDevices.rows.length,
        unconfiguredDeviceIds: unconfiguredDevices.map(({ device_id }) => device_id),
        unavailableDeviceIds: unavailableDevices.map(({ device_id }) => device_id),
        ioAvailable,
      },
    }),
    check({
      key: "participant_view",
      status: conditionCount > 0
        && missingLayouts.length === 0
        && emptyLayouts.length === 0
        && unresolvedWidgets.length === 0
        ? "ready"
        : "not_ready",
      blocking: true,
      blockingCode: missingLayouts.length > 0
        ? "PARTICIPANT_LAYOUT_REQUIRED"
        : emptyLayouts.length > 0
          ? "PARTICIPANT_WIDGET_REQUIRED"
          : unresolvedWidgets.length > 0
            ? "PARTICIPANT_WIDGET_UNAVAILABLE"
            : conditionCount === 0
              ? "CONDITION_REQUIRED"
              : null,
      message: missingLayouts.length > 0
        ? "Create a participant layout for every active condition."
        : emptyLayouts.length > 0
          ? "Place at least one widget in each participant layout."
          : unresolvedWidgets.length > 0
            ? "One or more participant widgets are unavailable."
            : "Participant layouts and widgets are ready.",
      correctionRoute: `${base}/participant-view`,
      details: {
        missingConditionIds: missingLayouts.map(({ id }) => id),
        emptyConditionIds: emptyLayouts.map(({ id }) => id),
        unresolvedWidgetInstanceIds: unresolvedWidgets.map(({ instance_id }) => instance_id),
      },
    }),
    check({
      key: "desktop_host",
      status: selectedHost?.ready === true ? "ready" : "not_ready",
      blocking: false,
      blockingCode: selectedHost === null
        ? overlayStatus.selectionRequired
          ? "DESKTOP_HOST_SELECTION_REQUIRED"
          : "DESKTOP_HOST_UNAVAILABLE"
        : selectedHost.ready
          ? null
          : "DESKTOP_HOST_NOT_READY",
      message: selectedHost?.ready === true
        ? `Desktop host ${selectedHost.hostId} is connected.`
        : overlayStatus.selectionRequired
          ? "Select one connected desktop host."
          : "Connect the desktop overlay host.",
      correctionRoute: "/settings/components",
      details: { selectedHostId: selectedHost?.hostId ?? null },
    }),
    check({
      key: "displays",
      status: desktopWidgets.length === 0
        || (selectedHost !== null && missingDisplayWidgets.length === 0)
        ? "ready"
        : "not_ready",
      blocking: false,
      blockingCode: desktopWidgets.length === 0 || (selectedHost !== null && missingDisplayWidgets.length === 0)
        ? null
        : selectedHost === null
          ? "DESKTOP_HOST_UNAVAILABLE"
          : "DISPLAY_ASSIGNMENT_MISSING",
      message: desktopWidgets.length === 0
        ? "No desktop display assignments are required."
        : selectedHost === null
          ? "Connect the desktop host to check saved display assignments."
          : missingDisplayWidgets.length > 0
            ? "Reassign widgets whose saved display is unavailable."
            : "Every desktop widget has an available display.",
      correctionRoute: `${base}/participant-view`,
      details: {
        displayCount: selectedHost?.displays.length ?? 0,
        affectedWidgetInstanceIds: missingDisplayWidgets.map(({ instance_id }) => instance_id),
      },
    }),
    check({
      key: "widget_renderer",
      status: desktopRendererReady && browserRendererReady ? "ready" : "not_ready",
      blocking: false,
      blockingCode: desktopRendererReady && browserRendererReady
        ? null
        : "WIDGET_RENDERER_UNAVAILABLE",
      message: desktopRendererReady && browserRendererReady
        ? "The required widget renderer is available."
        : "The desktop renderer is unavailable. Choose browser windows when starting the session.",
      correctionRoute: `${base}/participant-view`,
      details: {
        desktopWidgetCount: desktopWidgets.length,
        browserWidgetCount: browserWidgets.length,
        desktopRendererReady,
        browserRendererReady,
      },
    }),
    check({
      key: "study_status",
      status: ["ready", "running", "completed", "archived"].includes(study.status)
        ? "ready"
        : "not_ready",
      blocking: false,
      blockingCode: ["ready", "running", "completed", "archived"].includes(study.status)
        ? null
        : "STUDY_NOT_MARKED_READY",
      message: ["ready", "running", "completed", "archived"].includes(study.status)
        ? "The study has been marked ready."
        : "Mark the configured study as ready when every required step is complete.",
      correctionRoute: `${base}/overview#study-controls`,
      details: {
        studyStatus: study.status,
        nonterminalSessionCount: nonterminalSessions.rows[0]?.count ?? 0,
      },
    }),
  ];

  return StudyReadinessSchema.parse({
    studyId,
    ready: checks.every((entry) => !entry.blocking || entry.status === "ready"),
    checkedAt: new Date().toISOString(),
    checks,
  });
}

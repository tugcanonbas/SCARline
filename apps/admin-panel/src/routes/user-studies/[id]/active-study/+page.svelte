<script lang="ts">
  import { deserialize } from "$app/forms";
  import ActiveStudyEventsPanel from "$lib/components/admin/active-study/ActiveStudyEventsPanel.svelte";
  import ActiveStudyNotesPanel from "$lib/components/admin/active-study/ActiveStudyNotesPanel.svelte";
  import ActiveStudySensorStatusPanel from "$lib/components/admin/active-study/ActiveStudySensorStatusPanel.svelte";
  import ActiveStudySessionContext from "$lib/components/admin/active-study/ActiveStudySessionContext.svelte";
  import ActiveStudyTelemetryPanel from "$lib/components/admin/active-study/ActiveStudyTelemetryPanel.svelte";
  import ActiveStudyWidgetUpdatesPanel from "$lib/components/admin/active-study/ActiveStudyWidgetUpdatesPanel.svelte";
  import ActiveStudyWindowManagerPanel from "$lib/components/admin/active-study/ActiveStudyWindowManagerPanel.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import { createRealtimeStore } from "$lib/stores/realtime";
  import { formatDate, formatStatusLabel, shortId } from "$lib/format";
  import { appPath } from "$lib/paths";
  import { appendTelemetrySample, telemetryNumber } from "$lib/telemetry";
  import { untrack } from "svelte";

  // Route-level regression marker preserved for source-inspection tests:
  // Open All Widgets as Browser Windows

  let { data, form } = $props();

  type SessionOption = {
    id: string;
    name?: string | null;
    status: string;
    startedAt?: string | null;
    conditionId?: string | null;
    notes?: string | null;
    conditions?: Array<Record<string, unknown>>;
    activeCondition?: Record<string, unknown> | null;
    nextCondition?: Record<string, unknown> | null;
    conditionCount?: number;
    remainingConditionCount?: number;
    latestCommand?: Record<string, unknown> | null;
  };

  const live = createRealtimeStore();
  const {
    telemetry,
    events: sessionEvents,
    lifecycle,
    widgets: widgetUpdates,
    overlayWindows,
    sensorStatus,
    socketState,
    connect,
    disconnect,
  } = live;
  const runningSessionId = $derived(
    (data.sessions as SessionOption[]).find(
      (session) => session.status === "running",
    )?.id ?? "",
  );
  let selectedSession = $state(untrack(() => String(data.initialSelectedSessionId ?? "")));
  const latestTelemetry = $derived(
    ($telemetry.__latest ?? {}) as Record<string, unknown>,
  );
  const vehicleState = $derived(vehicle(latestTelemetry));
  const selectedSessionObj = $derived(
    (data.sessions as SessionOption[]).find(
      (session) => session.id === selectedSession,
    ) ?? null,
  );
  const latestLifecycle = $derived(
    ($lifecycle as Array<Record<string, unknown>>).find(
      (event) => event.sessionId === selectedSession,
    ) ?? null,
  );
  const selectedSessionStatus = $derived(
    String(latestLifecycle?.status ?? selectedSessionObj?.status ?? "created"),
  );
  const selectedCommand = $derived(
    latestLifecycle?.commandId
      ? {
          ...(selectedSessionObj?.latestCommand ?? {}),
          id: latestLifecycle.commandId,
          action: latestLifecycle.commandAction,
          status: latestLifecycle.commandStatus,
          errorMessage: latestLifecycle.commandError,
        }
      : selectedSessionObj?.latestCommand ?? null,
  );
  const commandPending = $derived(
    ["queued", "processing"].includes(String(selectedCommand?.status ?? "")),
  );

  // ─── Session elapsed timer ──────────────────────────────────────────────────
  let elapsedSeconds = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if (timerInterval) clearInterval(timerInterval);
    if (selectedSessionStatus === "running") {
      const startedAt = selectedSessionObj?.startedAt
        ? new Date(selectedSessionObj.startedAt).getTime()
        : Date.now();
      timerInterval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      }, 1000);
    } else {
      elapsedSeconds = 0;
    }
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  });

  function formatElapsed(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // ─── Telemetry history for mini charts (last 60 data points) ────────────────
  const MAX_HISTORY = 60;
  let speedHistory = $state<number[]>([]);
  let throttleHistory = $state<number[]>([]);
  let brakeHistory = $state<number[]>([]);

  $effect(() => {
    const v = vehicle(latestTelemetry);
    const speed = telemetryNumber(v.speed);
    const throttle = telemetryNumber(v.throttle);
    const brake = telemetryNumber(v.brake);
    speedHistory = appendTelemetrySample(untrack(() => speedHistory), speed, MAX_HISTORY);
    throttleHistory = appendTelemetrySample(untrack(() => throttleHistory), throttle, MAX_HISTORY);
    brakeHistory = appendTelemetrySample(untrack(() => brakeHistory), brake, MAX_HISTORY);
  });

  function miniChart(data: number[], color: string, maxVal?: number): string {
    if (data.length < 2) return "";
    const W = 120;
    const H = 32;
    const max = Math.max(maxVal ?? Math.max(...data, 1), 1);
    const pts = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - (v / max) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">` +
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    );
  }

  // ─── Operator notes ──────────────────────────────────────────────────────────
  type NoteEntry = { timestamp: string; text: string };
  let noteText = $state("");
  const noteEntries = $derived(parseNotes(selectedSessionObj?.notes ?? null));

  function parseNotes(raw: string | null): NoteEntry[] {
    return String(raw ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const match = entry.match(/^\[([^\]]+)\]\s*(.*)$/);
        return {
          timestamp: match?.[1]
            ? formatDate(match[1], "Unspecified time")
            : "Unspecified time",
          text: match?.[2] ?? entry,
        };
      })
      .reverse();
  }

  function handleNoteKeydown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.key !== "Enter") return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement | null)?.form?.requestSubmit();
  }

  $effect(() => {
    if (form?.noteSaved) {
      noteText = "";
    }
  });

  $effect(() => {
    if (!selectedSession && runningSessionId) {
      selectedSession = runningSessionId;
    }
  });

  $effect(() => {
    connect(
      [
        "session.events",
        "session.lifecycle",
        "session.telemetry",
        "widget.updates",
        "sensor.status",
        "overlay.windows",
      ],
      {
        studyId: data.studyId,
        sessionId: selectedSession || undefined,
      },
      data.webSocketOrigin,
    );
    return () => disconnect();
  });

  function vehicle(payload: Record<string, unknown>) {
    const p = payload.payload as Record<string, unknown> | undefined;
    return (p?.vehicle ?? payload.vehicle ?? p ?? payload) as Record<
      string,
      unknown
    >;
  }

  function eventTitle(event: Record<string, unknown>) {
    if (typeof event.status === "string") return formatStatusLabel(event.status);
    return String(event.eventType ?? "Session event");
  }

  function eventTime(event: Record<string, unknown>) {
    const value = (event.timestamp ?? event.startedAt ?? event.checkedAt) as
      | string
      | undefined;
    return value ? formatDate(value, "Live") : "Live";
  }

  function widgetTitle(update: Record<string, unknown>) {
    const id = update.widgetId ?? update.instanceId;
    return id ? `Widget ${id}` : "Widget update";
  }

  function sensorTitle(status: Record<string, unknown>) {
    const id = status.driverId ?? status.sensorId ?? status.componentId;
    return id ? `Sensor ${id}` : "Sensor";
  }
  const sessionTransitions: Record<string, string[]> = {
    created: ["start"],
    ready: ["start"],
    running: ["pause", "complete", "abort"],
    paused: ["resume", "complete", "abort"],
    completed: [],
    aborted: [],
    cancelled: [],
    failed: [],
  };
  const validSessionActions = $derived(
    selectedSession && !commandPending ? (sessionTransitions[selectedSessionStatus] ?? []) : [],
  );

  type WindowDraft = {
    instanceId: string;
    widgetId: string;
    mode: "transparent_electron" | "browser_popup";
    targetDisplay: string;
    order: number;
    inputMode: "click_through" | "interactive";
    enabled: boolean;
    configuration: Record<string, unknown>;
    bindingsConfig: Record<string, unknown>;
    styleOverrides: Record<string, unknown>;
    x: number;
    y: number;
    width: number;
    height: number;
    liveDisplay: string;
    degraded: boolean;
    degradedReason: string | null;
  };

  const selectedConditionId = $derived(String(
    selectedSessionObj?.activeCondition?.conditionId
      ?? selectedSessionObj?.nextCondition?.conditionId
      ?? selectedSessionObj?.conditionId
      ?? "",
  ));
  const activeParticipantLayout = $derived(
    (data.participantLayoutsByCondition as Record<string, Record<string, unknown> | null>)?.[selectedConditionId]
      ?? (data.layoutDetail as Record<string, unknown> | null),
  );
  const layoutId = $derived(
    String(activeParticipantLayout?.id ?? ""),
  );
  function conditionLayoutId(condition: Record<string, unknown> | null | undefined) {
    const snapshot = condition?.configurationSnapshot as Record<string, unknown> | undefined;
    const layouts = Array.isArray(snapshot?.layouts) ? snapshot.layouts as Array<Record<string, unknown>> : [];
    const participant = layouts.find((entry) => (entry.layout as Record<string, unknown> | undefined)?.type === "participant") ?? layouts[0];
    return String((participant?.layout as Record<string, unknown> | undefined)?.id ?? "");
  }
  const browserLayoutId = $derived(
    conditionLayoutId(selectedSessionObj?.activeCondition)
      || conditionLayoutId(selectedSessionObj?.nextCondition)
      || layoutId,
  );
  let initializedWindowLayoutId = $state("");
  let activeLayoutRevision = $state(0);
  let windowDrafts = $state<WindowDraft[]>([]);
  let savedWindows = $state<
    Record<string, { x: number; y: number; width: number; height: number }>
  >({});
  let windowUpdateStatus = $state<{ ok: boolean; message: string } | null>(
    null,
  );

  function initialLiveWindow(instanceId: string) {
    return ((data.overlayStatus?.windows ?? []) as Array<Record<string, unknown>>)
      .find((window) => String(window.instanceId ?? "") === instanceId) ?? null;
  }

  function buildWindowDrafts(): WindowDraft[] {
    return (
      (activeParticipantLayout?.widgets ?? []) as Array<Record<string, unknown>>
    ).map((widget) => {
      const instanceId = String(widget.id);
      const live = initialLiveWindow(instanceId);
      return {
        instanceId,
        widgetId: String(widget.widgetId),
        mode: (widget.windowMode === "browser_popup"
          ? "browser_popup"
          : "transparent_electron") as WindowDraft["mode"],
        targetDisplay: String(widget.targetDisplay ?? activeParticipantLayout?.targetDisplay ?? "primary"),
        order: Number(widget.order ?? 0),
        inputMode: widget.inputMode === "interactive" ? "interactive" : "click_through",
        enabled: widget.enabled !== false,
        configuration: asRecord(widget.configuration),
        bindingsConfig: asRecord(widget.bindingsConfig),
        styleOverrides: asRecord(widget.styleOverrides),
        x: Number(widget.x ?? 0),
        y: Number(widget.y ?? 0),
        width: Number(widget.width ?? 180),
        height: Number(widget.height ?? 180),
        liveDisplay: String(live?.liveDisplay ?? widget.targetDisplay ?? "primary"),
        degraded: live?.degraded === true,
        degradedReason: typeof live?.degradedReason === "string" ? live.degradedReason : null,
      };
    });
  }

  $effect(() => {
    const windowLayoutKey = `${selectedSession}:${layoutId}`;
    if (initializedWindowLayoutId !== windowLayoutKey) {
      windowDrafts = buildWindowDrafts();
      savedWindows = Object.fromEntries(
        windowDrafts.map((entry) => [
          entry.instanceId,
          { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
        ]),
      );
      activeLayoutRevision = Number(activeParticipantLayout?.revision ?? 0);
      initializedWindowLayoutId = windowLayoutKey;
    }
  });

  $effect(() => {
    const event = $overlayWindows[0];
    if (!event) return;
    const instanceId = String(event.instanceId ?? "");
    const drafts = untrack(() => windowDrafts);
    if (!drafts.some((entry) => entry.instanceId === instanceId)) return;
    if (event.type === "overlay.window.changed") {
      const bounds = asRecord(event.bounds);
      windowDrafts = drafts.map((entry) => entry.instanceId === instanceId ? {
        ...entry,
        x: Math.round(Number(bounds.x ?? entry.x)),
        y: Math.round(Number(bounds.y ?? entry.y)),
        width: Math.max(1, Math.round(Number(bounds.width ?? entry.width))),
        height: Math.max(1, Math.round(Number(bounds.height ?? entry.height))),
        liveDisplay: String(event.targetDisplay ?? entry.liveDisplay),
        degraded: false,
        degradedReason: null,
      } : entry);
    } else if (event.type === "overlay.window.status") {
      if (event.hostId && event.hostId !== data.overlayStatus?.selectedHostId) return;
      windowDrafts = drafts.map((entry) => entry.instanceId === instanceId ? {
        ...entry,
        liveDisplay: String(event.liveDisplay ?? entry.liveDisplay),
        degraded: event.degraded === true,
        degradedReason: typeof event.degradedReason === "string" ? event.degradedReason : null,
      } : entry);
    }
  });

  function updateDraft(instanceId: string, patch: Partial<WindowDraft>) {
    windowDrafts = windowDrafts.map((entry) =>
      entry.instanceId === instanceId ? { ...entry, ...patch } : entry,
    );
  }

  function launchPriority(left: WindowDraft, right: WindowDraft) {
    return left.order - right.order || left.y - right.y || left.x - right.x;
  }

  function getWidgetMeta(widgetId: string) {
    return (
      (data.widgets as Array<Record<string, unknown>>).find(
        (widget) => String(widget.id) === widgetId,
      ) ?? null
    );
  }

  function canonicalBounds(entry: WindowDraft) {
    return {
      x: Math.max(0, Math.round(entry.x)),
      y: Math.max(0, Math.round(entry.y)),
      width: Math.max(1, Math.round(entry.width)),
      height: Math.max(1, Math.round(entry.height)),
    };
  }

  function getWidgetOverlayUrl(
    layoutId: string,
    instanceId: string,
    mode: "transparent_electron" | "browser_popup",
  ) {
    const url = new URL(`${window.location.origin}/overlay/${layoutId}`);
    url.searchParams.set("studyId", data.studyId);
    url.searchParams.set("layoutId", layoutId);
    url.searchParams.set("instanceId", instanceId);
    url.searchParams.set("sessionId", selectedSession);
    url.searchParams.set(
      "chrome",
      mode === "transparent_electron" ? "transparent" : "web",
    );
    url.searchParams.set("toolbar", mode === "browser_popup" ? "1" : "0");
    if (selectedSessionObj?.conditionId) {
      url.searchParams.set("conditionId", selectedSessionObj.conditionId);
    }
    return url.toString();
  }

  async function openOverlayWindow(
    widget: WindowDraft,
    mode: "transparent_electron" | "browser_popup",
  ) {
    if (!browserLayoutId) {
      throw new Error("Participant layout is not available");
    }
    if (!selectedSession) {
      throw new Error("Select a session first");
    }

    const meta = getWidgetMeta(widget.widgetId);
    const widgetUi = (meta?.ui as Record<string, unknown> | undefined) ?? {};
    const bounds = canonicalBounds(widget);
    const targetDisplayValue = String(
      widget.targetDisplay ??
        (data.layoutDetail as Record<string, unknown> | null)?.targetDisplay ??
        "primary",
    );
    const response = await fetch(appPath("/api/system/overlay/windows/open"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        studyId: data.studyId,
        layoutId: browserLayoutId,
        instanceId: widget.instanceId,
        sessionId: selectedSession,
        conditionId: selectedSessionObj?.conditionId ?? null,
        mode,
        targetDisplay: targetDisplayValue,
        bounds,
      }),
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message ||
        "Couldn't open the participant display window. Make sure the SCARline desktop app is running on the operator machine, then try again.",
    );
  }

  async function launchBrowserWidgetWindows() {
    if (!selectedSession) {
      windowUpdateStatus = { ok: false, message: "Select a session first" };
      return;
    }
    if (!browserLayoutId) {
      windowUpdateStatus = {
        ok: false,
        message: "Participant layout is not available",
      };
      return;
    }

    const targets = [...windowDrafts].sort(launchPriority);
    if (targets.length === 0) {
      windowUpdateStatus = {
        ok: false,
        message: "No widget windows in participant layout",
      };
      return;
    }

    const launcher = window.open(
      "about:blank",
      `scarline-session-${selectedSession}`,
      "popup=yes,width=760,height=680,resizable=yes,scrollbars=yes",
    );

    try {
      const response = await fetch(appPath("/api/system/overlay/render-grants"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rendererMode: "browser",
          layoutId: browserLayoutId,
          instanceId: null,
          sessionId: selectedSession,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.data?.launchUrl !== "string") {
        throw new Error(payload?.error?.message ?? "Failed to authorize the browser overlay");
      }
      const target = launcher ?? window.open(payload.data.launchUrl, `scarline-session-${selectedSession}`, "popup=yes,width=760,height=680,resizable=yes,scrollbars=yes");
      if (target === null) throw new Error("The browser blocked the overlay launcher. Allow popups for SCARline and try again.");
      target.location.href = payload.data.launchUrl;
      windowUpdateStatus = { ok: true, message: `Overlay launcher opened for ${targets.length} widget(s)` };
    } catch (error) {
      if (launcher !== null && !launcher.closed) launcher.close();
      windowUpdateStatus = {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to open browser widget windows",
      };
    }
  }

  async function applyWindowUpdate(instanceId: string) {
    const target = windowDrafts.find(
      (entry) => entry.instanceId === instanceId,
    );
    if (!target || !layoutId) {
      return;
    }
    windowUpdateStatus = null;
    const formData = new FormData();
    formData.set("layoutId", layoutId);
    formData.set("sessionId", selectedSession);
    formData.set(
      "windows",
      JSON.stringify([
        {
          instanceId: target.instanceId,
          expectedRevision: activeLayoutRevision,
          mode: target.mode,
          inputMode: target.inputMode,
          targetDisplay: target.targetDisplay,
          order: target.order,
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
          enabled: target.enabled,
          configuration: target.configuration,
          bindingsConfig: target.bindingsConfig,
          styleOverrides: target.styleOverrides,
        },
      ]),
    );
    const response = await fetch("?/windowUpdate", {
      method: "POST",
      body: formData,
    });
    const result = deserialize(await response.text());
    const resultData = ("data" in result ? result.data ?? {} : {}) as Record<string, unknown>;
    const saved = resultData.windowUpdated === true || resultData.saved === true;
    const revision = Number(resultData.revision ?? 0);
    if (revision > 0) activeLayoutRevision = revision;
    windowUpdateStatus = result.type === "success"
      ? { ok: true, message: `Window updated: ${target.widgetId}` }
      : {
          ok: false,
          message: typeof resultData.message === "string"
            ? resultData.message
            : `Failed to update window: ${target.widgetId}`,
        };
    if (saved) {
      savedWindows = {
        ...savedWindows,
        [target.instanceId]: {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        },
      };
    }
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
</script>

<PageHeader
  eyebrow="Operator"
  title="Active Study Controls"
  description="Realtime session supervision, telemetry inspection, and manual widget control for the current study."
/>
<StudyTabs
  studyId={data.studyId}
  current={`/user-studies/${data.studyId}/active-study`}
/>

<details class="surface-card mt-4 mb-4">
  <summary class="surface-card__title" style="cursor: pointer;"
    >What am I looking at?</summary
  >
  <div class="surface-card__body mt-3 kv-grid">
    <div class="kv-item">
      <p class="kv-label">Session Context</p>
      <p class="kv-value">Pick the active session and start, pause, or end it.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Live Telemetry</p>
      <p class="kv-value">The vehicle's live speed, pedals, and steering.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Session Events</p>
      <p class="kv-value">A running log of what's happened in this session so far.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Widget Updates</p>
      <p class="kv-value">Manually trigger a widget to show, hide, or change on the participant's display.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Window Manager</p>
      <p class="kv-value">Reposition or resize the widget windows on the participant's display.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Sensor Status</p>
      <p class="kv-value">Whether connected hardware (wheel, eye tracker, etc.) is reporting in.</p>
    </div>
    <div class="kv-item">
      <p class="kv-label">Operator Notes</p>
      <p class="kv-value">Your own timestamped observations during the session.</p>
    </div>
  </div>
</details>

<div class="metric-grid">
  <MetricCard label="Connection" hint="Live link for session, telemetry, widget, and sensor updates">
    {#snippet valueContent()}
      <div class="metric-card__content">
        <StatusBadge status={$socketState} />
      </div>
    {/snippet}
  </MetricCard>
  <MetricCard
    label="Session Timer"
    value={selectedSessionStatus === "running"
      ? formatElapsed(elapsedSeconds)
      : selectedSessionStatus === "paused"
        ? "Paused"
        : "—"}
    hint={selectedSession ? selectedSessionStatus : "No session selected"}
  />
  <MetricCard
    label="Speed"
    value={`${vehicleState.speed ?? "—"} km/h`}
    hint={`Limit: ${vehicleState.speedLimit ?? "—"} km/h`}
  />
  <MetricCard
    label="Active Widgets"
    value={data.triggerableWidgets.length}
    hint="Available in active layout"
  />
</div>

<div class="section-grid section-grid--sidebar mt-4">
  <ActiveStudySessionContext
    formMessage={form?.message ?? ""}
    bind:selectedSession
    sessions={data.sessions}
    socketState={$socketState}
    layoutsLength={data.layouts.length}
    canOperate={data.canOperate}
    {validSessionActions}
    latestCommand={selectedCommand}
    commandPending={commandPending}
    desktopConnected={data.overlayStatus?.connected === true}
    selectedHostId={String(data.overlayStatus?.selectedHostId ?? "")}
    overlayFailure={(selectedSessionObj?.latestCommand?.resultPayload as Record<string, unknown> | undefined)?.overlayFailure as Record<string, unknown> | undefined}
    browserMessage={windowUpdateStatus?.message ?? ""}
    browserMessageIsError={windowUpdateStatus?.ok === false}
    onLaunchBrowserWidgets={launchBrowserWidgetWindows}
    hasLayout={Boolean(browserLayoutId)}
    hasWindows={windowDrafts.length > 0}
  />

  <ActiveStudyTelemetryPanel
    {vehicleState}
    {speedHistory}
    {throttleHistory}
    {brakeHistory}
    {miniChart}
  />
</div>

<div class="mt-4 section-grid section-grid--balanced">
  <ActiveStudyEventsPanel
    events={[...$lifecycle, ...$sessionEvents]}
    {eventTitle}
    {eventTime}
    {selectedSession}
    selectedSessionDetail={selectedSessionObj}
    canOperate={data.canOperate}
    commandPending={commandPending}
    liveLifecycle={latestLifecycle}
  />
  <ActiveStudyWidgetUpdatesPanel
    canOperate={data.canOperate}
    triggerableWidgets={data.triggerableWidgets}
    {selectedSession}
    widgetUpdates={$widgetUpdates}
    {widgetTitle}
  />
</div>

<div class="mt-4">
  <ActiveStudyWindowManagerPanel
    {windowUpdateStatus}
    {windowDrafts}
    {savedWindows}
    canOperate={data.canOperate}
    {updateDraft}
    {applyWindowUpdate}
  />
</div>

<div class="mt-4 section-grid section-grid--balanced">
  <ActiveStudySensorStatusPanel sensorStatuses={$sensorStatus} {sensorTitle} />
  <ActiveStudyNotesPanel
    {selectedSession}
    canOperate={data.canOperate}
    bind:noteText
    onHandleNoteKeydown={handleNoteKeydown}
    {noteEntries}
  />
</div>

<script lang="ts">
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
  import { untrack } from "svelte";

  // Route-level regression marker preserved for source-inspection tests:
  // Launch Browser Popup Widgets

  let { data, form } = $props();

  type SessionOption = {
    id: string;
    name?: string | null;
    status: string;
    startedAt?: string | null;
    conditionId?: string | null;
    notes?: string | null;
  };

  const live = createRealtimeStore();
  const {
    telemetry,
    events: sessionEvents,
    widgets: widgetUpdates,
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
  let selectedSession = $state("");
  const latestTelemetry = $derived(
    ($telemetry.__latest ?? {}) as Record<string, unknown>,
  );
  const vehicleState = $derived(vehicle(latestTelemetry));
  const selectedSessionObj = $derived(
    (data.sessions as SessionOption[]).find(
      (session) => session.id === selectedSession,
    ) ?? null,
  );
  const selectedSessionStatus = $derived(
    selectedSessionObj?.status ?? "created",
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

  function pushTelemetrySample(history: number[], nextValue: number) {
    return [...history.slice(-MAX_HISTORY + 1), nextValue];
  }

  $effect(() => {
    const v = vehicle(latestTelemetry);
    const speed = Number(v.speed ?? 0);
    const throttle = Number(v.throttle ?? 0);
    const brake = Number(v.brake ?? 0);
    if (speed > 0 || throttle > 0 || brake > 0) {
      speedHistory = pushTelemetrySample(
        untrack(() => speedHistory),
        speed,
      );
      throttleHistory = pushTelemetrySample(
        untrack(() => throttleHistory),
        throttle,
      );
      brakeHistory = pushTelemetrySample(
        untrack(() => brakeHistory),
        brake,
      );
    }
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
          timestamp: match?.[1] ?? "Recorded note",
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
      data.token,
      [
        "session.events",
        "session.telemetry",
        "widget.updates",
        "sensor.status",
      ],
      {
        studyId: data.studyId,
        sessionId: selectedSession || undefined,
      },
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
    return String(
      event.status ?? event.eventType ?? event.routingKey ?? "Session event",
    );
  }

  function eventTime(event: Record<string, unknown>) {
    return String(
      event.timestamp ?? event.startedAt ?? event.checkedAt ?? "Live",
    );
  }

  function widgetTitle(update: Record<string, unknown>) {
    return String(
      update.widgetId ??
        update.instanceId ??
        update.routingKey ??
        "Widget update",
    );
  }

  function sensorTitle(status: Record<string, unknown>) {
    return String(
      status.driverId ?? status.sensorId ?? status.componentId ?? "Sensor",
    );
  }
  function canTransition(actionName: string) {
    const allowedTransitions: Record<string, string[]> = {
      created: ["start"],
      running: ["pause", "complete", "cancel"],
      paused: ["resume", "cancel"],
      completed: [],
      cancelled: [],
    };
    return selectedSession
      ? (allowedTransitions[selectedSessionStatus]?.includes(actionName) ??
          false)
      : false;
  }

  type WindowDraft = {
    instanceId: string;
    widgetId: string;
    mode: "transparent_electron" | "browser_popup";
    targetDisplay: string;
    order: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };

  const layoutId = $derived(
    String((data.layoutDetail as Record<string, unknown> | null)?.id ?? ""),
  );
  let initializedWindowLayoutId = $state("");
  let windowDrafts = $state<WindowDraft[]>([]);
  let windowUpdateStatus = $state<{ ok: boolean; message: string } | null>(
    null,
  );

  function buildWindowDrafts(): WindowDraft[] {
    return (
      (data.layoutDetail?.widgets ?? []) as Array<Record<string, unknown>>
    ).map((widget) => ({
      instanceId: String(widget.id),
      widgetId: String(widget.widgetId),
      mode: (widget.windowMode === "browser_popup"
        ? "browser_popup"
        : "transparent_electron") as WindowDraft["mode"],
      targetDisplay: String(
        widget.targetDisplay ??
          (data.layoutDetail as Record<string, unknown> | null)
            ?.targetDisplay ??
          "0",
      ),
      order: Number(widget.order ?? 0),
      x: Number(widget.x ?? 0),
      y: Number(widget.y ?? 0),
      width: Number(widget.width ?? 180),
      height: Number(widget.height ?? 180),
    }));
  }

  $effect(() => {
    if (initializedWindowLayoutId !== layoutId) {
      windowDrafts = buildWindowDrafts();
      initializedWindowLayoutId = layoutId;
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
    if (data.token) url.searchParams.set("token", data.token);
    if (selectedSessionObj?.conditionId) {
      url.searchParams.set("conditionId", selectedSessionObj.conditionId);
    }
    return url.toString();
  }

  async function openOverlayWindow(
    widget: WindowDraft,
    mode: "transparent_electron" | "browser_popup",
  ) {
    if (!layoutId) {
      throw new Error("Participant layout is not available");
    }
    if (!selectedSession) {
      throw new Error("Select a session first");
    }

    const meta = getWidgetMeta(widget.widgetId);
    const widgetUi = (meta?.ui as Record<string, unknown> | undefined) ?? {};
    const bounds = canonicalBounds(widget);
    const targetDisplayValue = Math.max(
      0,
      Number(
        widget.targetDisplay ??
          (data.layoutDetail as Record<string, unknown> | null)
            ?.targetDisplay ??
          0,
      ) || 0,
    );
    const response = await fetch("/api/system/overlay/windows/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.token}`,
      },
      body: JSON.stringify({
        studyId: data.studyId,
        layoutId,
        instanceId: widget.instanceId,
        sessionId: selectedSession,
        conditionId: selectedSessionObj?.conditionId ?? null,
        mode,
        targetDisplay: targetDisplayValue,
      }),
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const directResponse = await fetch("http://127.0.0.1:4097/windows/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "windows",
        targetDisplay: targetDisplayValue,
        windows: [
          {
            instanceId: widget.instanceId,
            widgetId: widget.widgetId,
            mode,
            clickThrough: false,
            bounds,
            minWidth: Number(widgetUi.minWidth ?? bounds.width),
            minHeight: Number(widgetUi.minHeight ?? bounds.height),
            preferredWidth: Number(widgetUi.preferredWidth ?? bounds.width),
            preferredHeight: Number(widgetUi.preferredHeight ?? bounds.height),
            url: getWidgetOverlayUrl(layoutId, widget.instanceId, mode),
          },
        ],
        session: {
          studyId: data.studyId,
          sessionId: selectedSession,
          layoutId,
          conditionId: selectedSessionObj?.conditionId ?? null,
        },
      }),
    }).catch(() => null);
    if (!directResponse?.ok) {
      throw new Error(
        payload?.error?.message ||
          "Failed to open overlay widget window. Ensure the overlay window control server is running.",
      );
    }
  }

  async function launchBrowserWidgetWindows() {
    if (!selectedSession) {
      windowUpdateStatus = { ok: false, message: "Select a session first" };
      return;
    }
    if (!layoutId) {
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

    let opened = 0;
    for (const widget of targets) {
      try {
        await openOverlayWindow(widget, "browser_popup");
        opened += 1;
      } catch (error) {
        console.error(
          "Failed to launch browser widget window",
          widget.instanceId,
          error,
        );
      }
    }

    windowUpdateStatus =
      opened > 0
        ? { ok: true, message: `Opened ${opened} browser widget window(s)` }
        : { ok: false, message: "Failed to open browser widget windows" };
  }

  function nudgeWindow(entry: WindowDraft, dx = 0, dy = 0) {
    updateDraft(entry.instanceId, {
      x: Math.max(0, entry.x + dx),
      y: Math.max(0, entry.y + dy),
    });
  }

  function resizeWindow(entry: WindowDraft, dw = 0, dh = 0) {
    updateDraft(entry.instanceId, {
      width: Math.max(1, entry.width + dw),
      height: Math.max(1, entry.height + dh),
    });
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
    formData.set(
      "windows",
      JSON.stringify([
        {
          instanceId: target.instanceId,
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        },
      ]),
    );
    const response = await fetch("?/windowUpdate", {
      method: "POST",
      body: formData,
    });
    windowUpdateStatus = response.ok
      ? { ok: true, message: `Window updated: ${target.widgetId}` }
      : { ok: false, message: `Failed to update window: ${target.widgetId}` };
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

<div class="metric-grid">
  <MetricCard label="Socket" hint="Session, telemetry, widget, sensor channels">
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
    label="Triggers"
    value={data.triggerableWidgets.length}
    hint="Widgets in active layout"
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
    {canTransition}
    onLaunchBrowserWidgets={launchBrowserWidgetWindows}
    hasLayout={Boolean(layoutId)}
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
    events={$sessionEvents}
    {eventTitle}
    {eventTime}
    {selectedSession}
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
    canOperate={data.canOperate}
    {updateDraft}
    {nudgeWindow}
    {resizeWindow}
    {applyWindowUpdate}
  />
</div>

<div class="mt-4 section-grid section-grid--balanced">
  <ActiveStudySensorStatusPanel sensorStatuses={$sensorStatus} {sensorTitle} />
  <ActiveStudyNotesPanel
    {selectedSession}
    bind:noteText
    onHandleNoteKeydown={handleNoteKeydown}
    {noteEntries}
  />
</div>

<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { createRealtimeStore } from '$lib/stores/realtime';

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
    disconnect
  } = live;
  const runningSessionId = $derived(
    (data.sessions as SessionOption[]).find((session) => session.status === 'running')?.id ?? ''
  );
  let selectedSession = $state('');
  const latestTelemetry = $derived(($telemetry.__latest ?? {}) as Record<string, unknown>);
  const selectedSessionObj = $derived(
    (data.sessions as SessionOption[]).find((session) => session.id === selectedSession) ?? null
  );
  const selectedSessionStatus = $derived(selectedSessionObj?.status ?? 'created');

  // ─── Session elapsed timer ──────────────────────────────────────────────────
  let elapsedSeconds = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if (timerInterval) clearInterval(timerInterval);
    if (selectedSessionStatus === 'running') {
      const startedAt = selectedSessionObj?.startedAt ? new Date(selectedSessionObj.startedAt).getTime() : Date.now();
      timerInterval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      }, 1000);
    } else {
      elapsedSeconds = 0;
    }
    return () => { if (timerInterval) clearInterval(timerInterval); };
  });

  function formatElapsed(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ─── Telemetry history for mini charts (last 60 data points) ────────────────
  const MAX_HISTORY = 60;
  let speedHistory = $state<number[]>([]);
  let throttleHistory = $state<number[]>([]);
  let brakeHistory = $state<number[]>([]);

  $effect(() => {
    const v = vehicle(latestTelemetry);
    const speed = Number(v.speed ?? 0);
    const throttle = Number(v.throttle ?? 0);
    const brake = Number(v.brake ?? 0);
    if (speed > 0 || throttle > 0 || brake > 0) {
      speedHistory = [...speedHistory.slice(-MAX_HISTORY + 1), speed];
      throttleHistory = [...throttleHistory.slice(-MAX_HISTORY + 1), throttle];
      brakeHistory = [...brakeHistory.slice(-MAX_HISTORY + 1), brake];
    }
  });

  function miniChart(data: number[], color: string, maxVal?: number): string {
    if (data.length < 2) return '';
    const W = 120; const H = 32;
    const max = Math.max(maxVal ?? Math.max(...data, 1), 1);
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - (v / max) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block">`
      + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ─── Operator notes ──────────────────────────────────────────────────────────
  type NoteEntry = { timestamp: string; text: string };
  let noteText = $state('');
  const noteEntries = $derived(parseNotes(selectedSessionObj?.notes ?? null));

  function parseNotes(raw: string | null): NoteEntry[] {
    return String(raw ?? '')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const match = entry.match(/^\[([^\]]+)\]\s*(.*)$/);
        return {
          timestamp: match?.[1] ?? 'Recorded note',
          text: match?.[2] ?? entry
        };
      })
      .reverse();
  }

  function handleNoteKeydown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.key !== 'Enter') return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement | null)?.form?.requestSubmit();
  }

  $effect(() => {
    if (form?.noteSaved) {
      noteText = '';
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
      ['session.events', 'session.telemetry', 'widget.updates', 'sensor.status'],
      {
        studyId: data.studyId,
        sessionId: selectedSession || undefined
      }
    );
    return () => disconnect();
  });

  function vehicle(payload: Record<string, unknown>) {
    const p = payload.payload as Record<string, unknown> | undefined;
    return ((p?.vehicle ?? payload.vehicle ?? p ?? payload)) as Record<string, unknown>;
  }

  function eventTitle(event: Record<string, unknown>) {
    return String(event.status ?? event.eventType ?? event.routingKey ?? 'Session event');
  }

  function eventTime(event: Record<string, unknown>) {
    return String(event.timestamp ?? event.startedAt ?? event.checkedAt ?? 'Live');
  }

  function widgetTitle(update: Record<string, unknown>) {
    return String(update.widgetId ?? update.instanceId ?? update.routingKey ?? 'Widget update');
  }

  function sensorTitle(status: Record<string, unknown>) {
    return String(status.driverId ?? status.sensorId ?? status.componentId ?? 'Sensor');
  }
  function canTransition(actionName: string) {
    const allowedTransitions: Record<string, string[]> = {
      created: ['start'],
      running: ['pause', 'complete', 'cancel'],
      paused: ['resume', 'cancel'],
      completed: [],
      cancelled: []
    };
    return selectedSession ? (allowedTransitions[selectedSessionStatus]?.includes(actionName) ?? false) : false;
  }

  type WindowDraft = {
    instanceId: string;
    widgetId: string;
    mode: 'transparent_electron' | 'browser_popup';
    order: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };

  const layoutId = $derived(String((data.layoutDetail as Record<string, unknown> | null)?.id ?? ''));
  let initializedWindowLayoutId = $state('');
  let windowDrafts = $state<WindowDraft[]>([]);
  let windowUpdateStatus = $state<{ ok: boolean; message: string } | null>(null);

  function buildWindowDrafts(): WindowDraft[] {
    return ((data.layoutDetail?.widgets ?? []) as Array<Record<string, unknown>>).map((widget) => ({
      instanceId: String(widget.id),
      widgetId: String(widget.widgetId),
      mode: (widget.windowMode === 'browser_popup' ? 'browser_popup' : 'transparent_electron') as WindowDraft['mode'],
      order: Number(widget.order ?? 0),
      x: Number(widget.x ?? 0),
      y: Number(widget.y ?? 0),
      width: Number(widget.width ?? 180),
      height: Number(widget.height ?? 180)
    }));
  }

  $effect(() => {
    if (initializedWindowLayoutId !== layoutId) {
      windowDrafts = buildWindowDrafts();
      initializedWindowLayoutId = layoutId;
    }
  });

  function updateDraft(instanceId: string, patch: Partial<WindowDraft>) {
    windowDrafts = windowDrafts.map((entry) => (entry.instanceId === instanceId ? { ...entry, ...patch } : entry));
  }

  function launchPriority(left: WindowDraft, right: WindowDraft) {
    return left.order - right.order || left.y - right.y || left.x - right.x;
  }

  function getWidgetMeta(widgetId: string) {
    return (data.widgets as Array<Record<string, unknown>>).find((widget) => String(widget.id) === widgetId) ?? null;
  }

  function canonicalBounds(entry: WindowDraft) {
    return {
      x: Math.max(0, Math.round(entry.x)),
      y: Math.max(0, Math.round(entry.y)),
      width: Math.max(1, Math.round(entry.width)),
      height: Math.max(1, Math.round(entry.height))
    };
  }

  function getWidgetOverlayUrl(layoutId: string, instanceId: string, mode: 'transparent_electron' | 'browser_popup') {
    const url = new URL(`${window.location.origin}/overlay/${layoutId}`);
    url.searchParams.set('studyId', data.studyId);
    url.searchParams.set('layoutId', layoutId);
    url.searchParams.set('instanceId', instanceId);
    url.searchParams.set('sessionId', selectedSession);
    url.searchParams.set('chrome', mode === 'transparent_electron' ? 'transparent' : 'web');
    url.searchParams.set('toolbar', mode === 'browser_popup' ? '1' : '0');
    if (data.token) url.searchParams.set('token', data.token);
    if (selectedSessionObj?.conditionId) {
      url.searchParams.set('conditionId', selectedSessionObj.conditionId);
    }
    return url.toString();
  }

  async function openOverlayWindow(
    widget: WindowDraft,
    mode: 'transparent_electron' | 'browser_popup'
  ) {
    if (!layoutId) {
      throw new Error('Participant layout is not available');
    }
    if (!selectedSession) {
      throw new Error('Select a session first');
    }

    const meta = getWidgetMeta(widget.widgetId);
    const widgetUi = (meta?.ui as Record<string, unknown> | undefined) ?? {};
    const bounds = canonicalBounds(widget);
    const targetDisplayValue = Math.max(0, Number((data.layoutDetail as Record<string, unknown> | null)?.targetDisplay ?? 0) || 0);
    const response = await fetch('/api/system/overlay/windows/open', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.token}`
      },
      body: JSON.stringify({
        studyId: data.studyId,
        layoutId,
        instanceId: widget.instanceId,
        sessionId: selectedSession,
        conditionId: selectedSessionObj?.conditionId ?? null,
        mode
      })
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const directResponse = await fetch('http://127.0.0.1:4097/windows/open', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        mode: 'windows',
        targetDisplay: targetDisplayValue,
        windows: [{
          instanceId: widget.instanceId,
          widgetId: widget.widgetId,
          mode,
          clickThrough: false,
          bounds,
          minWidth: Number(widgetUi.minWidth ?? bounds.width),
          minHeight: Number(widgetUi.minHeight ?? bounds.height),
          preferredWidth: Number(widgetUi.preferredWidth ?? bounds.width),
          preferredHeight: Number(widgetUi.preferredHeight ?? bounds.height),
          url: getWidgetOverlayUrl(layoutId, widget.instanceId, mode)
        }],
        session: {
          studyId: data.studyId,
          sessionId: selectedSession,
          layoutId,
          conditionId: selectedSessionObj?.conditionId ?? null
        }
      })
    }).catch(() => null);
    if (!directResponse?.ok) {
      throw new Error(payload?.error?.message || 'Failed to open overlay widget window. Ensure the overlay window control server is running.');
    }
  }

  async function launchBrowserWidgetWindows() {
    if (!selectedSession) {
      windowUpdateStatus = { ok: false, message: 'Select a session first' };
      return;
    }
    if (!layoutId) {
      windowUpdateStatus = { ok: false, message: 'Participant layout is not available' };
      return;
    }

    const targets = [...windowDrafts].sort(launchPriority);
    if (targets.length === 0) {
      windowUpdateStatus = { ok: false, message: 'No widget windows in participant layout' };
      return;
    }

    let opened = 0;
    for (const widget of targets) {
      try {
        await openOverlayWindow(widget, 'browser_popup');
        opened += 1;
      } catch (error) {
        console.error('Failed to launch browser widget window', widget.instanceId, error);
      }
    }

    windowUpdateStatus = opened > 0
      ? { ok: true, message: `Opened ${opened} browser widget window(s)` }
      : { ok: false, message: 'Failed to open browser widget windows' };
  }

  function nudgeWindow(entry: WindowDraft, dx = 0, dy = 0) {
    updateDraft(entry.instanceId, {
      x: Math.max(0, entry.x + dx),
      y: Math.max(0, entry.y + dy)
    });
  }

  function resizeWindow(entry: WindowDraft, dw = 0, dh = 0) {
    updateDraft(entry.instanceId, {
      width: Math.max(1, entry.width + dw),
      height: Math.max(1, entry.height + dh)
    });
  }

  async function applyWindowUpdate(instanceId: string) {
    const target = windowDrafts.find((entry) => entry.instanceId === instanceId);
    if (!target || !layoutId) {
      return;
    }
    windowUpdateStatus = null;
    const formData = new FormData();
    formData.set('layoutId', layoutId);
    formData.set('windows', JSON.stringify([{
      instanceId: target.instanceId,
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height
    }]));
    const response = await fetch('?/windowUpdate', { method: 'POST', body: formData });
    windowUpdateStatus = response.ok
      ? { ok: true, message: `Window updated: ${target.widgetId}` }
      : { ok: false, message: `Failed to update window: ${target.widgetId}` };
  }
</script>

<PageHeader eyebrow="Operator" title="Active Study Controls" description="Realtime session supervision, telemetry inspection, and manual widget control for the current study." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/active-study`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Socket</p>
    <div class="mt-2"><StatusBadge status={$socketState} /></div>
    <p class="metric-card__hint">Session, telemetry, widget, sensor channels</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Session Timer</p>
    <p class="metric-card__value" style="font-variant-numeric: tabular-nums">
      {selectedSessionStatus === 'running' ? formatElapsed(elapsedSeconds) : (selectedSessionStatus === 'paused' ? 'Paused' : '—')}
    </p>
    <p class="metric-card__hint">{selectedSession ? selectedSessionStatus : 'No session selected'}</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Speed</p>
    <p class="metric-card__value">{vehicle(latestTelemetry).speed ?? '—'} <span style="font-size:0.6em;opacity:0.6">km/h</span></p>
    <p class="metric-card__hint">Limit: {vehicle(latestTelemetry).speedLimit ?? '—'} km/h</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Triggers</p>
    <p class="metric-card__value">{data.triggerableWidgets.length}</p>
    <p class="metric-card__hint">Widgets in active layout</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
  <SurfaceCard title="Session Context" subtitle="Operator control context without changing the session lifecycle actions.">
    {#if form?.message}
      <p class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">{form.message}</p>
    {/if}
    <label class="grid gap-2 text-sm">
      <span>Active Session</span>
      <select bind:value={selectedSession} class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
        <option value="">Select session</option>
        {#each data.sessions as session}
          <option value={session.id}>{session.name ?? session.id} ({session.status})</option>
        {/each}
      </select>
    </label>
    <div class="mt-4 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
      <div class="flex items-center justify-between gap-3">
        <span>Realtime socket state</span>
        <StatusBadge status={$socketState} />
      </div>
      <p>Layouts configured: <strong>{data.layouts.length}</strong></p>
    </div>
    {#if data.canOperate}
      <div class="mt-4 control-rail">
        <form method="POST" action="?/start">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <button disabled={!canTransition('start')} type="submit">Start</button>
        </form>
        <form method="POST" action="?/pause">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <button disabled={!canTransition('pause')} type="submit">Pause</button>
        </form>
        <form method="POST" action="?/resume">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <button disabled={!canTransition('resume')} type="submit">Resume</button>
        </form>
        <form method="POST" action="?/complete">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <button disabled={!canTransition('complete')} type="submit">Complete</button>
        </form>
        <form method="POST" action="?/cancel">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <input type="hidden" name="reason" value="Operator cancelled session" />
          <button disabled={!canTransition('cancel')} type="submit">Cancel</button>
        </form>
      </div>
      <button
        class="mt-4 rounded-xl border border-[--color-line] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={!selectedSession || !layoutId || windowDrafts.length === 0}
        onclick={launchBrowserWidgetWindows}
      >
        Launch Browser Popup Widgets
      </button>
    {/if}
    <p class="mt-4 text-sm text-slate-400">Session lifecycle controls are wired to CoreAPI command routes for operator execution.</p>
  </SurfaceCard>

  <SurfaceCard title="Live Telemetry" subtitle="Vehicle state received via CoreAPI WebSocket fanout — mini charts show last 60 data points.">
    <div class="telemetry-chart-grid">
      <div class="telemetry-tile">
        <div class="telemetry-tile__header">
          <span class="telemetry-tile__label">Speed</span>
          <span class="telemetry-tile__value">{vehicle(latestTelemetry).speed ?? '—'} <small>km/h</small></span>
        </div>
        {#if speedHistory.length > 1}
          <div class="telemetry-tile__chart">{@html miniChart(speedHistory, '#818cf8', undefined)}</div>
        {:else}
          <div class="telemetry-tile__chart telemetry-tile__chart--empty">Awaiting stream</div>
        {/if}
      </div>
      <div class="telemetry-tile">
        <div class="telemetry-tile__header">
          <span class="telemetry-tile__label">Throttle</span>
          <span class="telemetry-tile__value">{Math.round(Number(vehicle(latestTelemetry).throttle ?? 0) * 100)}%</span>
        </div>
        {#if throttleHistory.length > 1}
          <div class="telemetry-tile__chart">{@html miniChart(throttleHistory, '#34d399', 1)}</div>
        {:else}
          <div class="telemetry-tile__chart telemetry-tile__chart--empty">Awaiting stream</div>
        {/if}
      </div>
      <div class="telemetry-tile">
        <div class="telemetry-tile__header">
          <span class="telemetry-tile__label">Brake</span>
          <span class="telemetry-tile__value">{Math.round(Number(vehicle(latestTelemetry).brake ?? 0) * 100)}%</span>
        </div>
        {#if brakeHistory.length > 1}
          <div class="telemetry-tile__chart">{@html miniChart(brakeHistory, '#fb923c', 1)}</div>
        {:else}
          <div class="telemetry-tile__chart telemetry-tile__chart--empty">Awaiting stream</div>
        {/if}
      </div>
      <div class="telemetry-tile">
        <div class="telemetry-tile__header">
          <span class="telemetry-tile__label">Steer</span>
          <span class="telemetry-tile__value">{vehicle(latestTelemetry).steer ?? '—'}</span>
        </div>
        <div class="telemetry-tile__chart telemetry-tile__chart--empty" style="font-size:0.6875rem;color:#475569">Heading: {vehicle(latestTelemetry).heading ?? '—'}</div>
      </div>
    </div>
    <div class="mt-3 border-t border-[--color-line] pt-3">
      <KeyValueGrid
        items={[
          { label: 'Speed Limit', value: vehicle(latestTelemetry).speedLimit ?? '—' },
          { label: 'Routing Key', value: String(latestTelemetry.routingKey ?? 'Waiting for stream') }
        ]}
      />
    </div>
  </SurfaceCard>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
  <SurfaceCard title="Session Events" subtitle="Lifecycle and simulator events for the selected run.">
    <div class="timeline-list">
      {#each $sessionEvents as event}
        <div class="timeline-entry text-sm">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold">{eventTitle(event)}</p>
            <span class="text-xs text-slate-500">{eventTime(event)}</span>
          </div>
          <p class="mt-1 text-slate-400">Session {event.sessionId ?? selectedSession ?? 'unknown'}</p>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">Waiting for session lifecycle events.</p>
      {/each}
    </div>
  </SurfaceCard>
  <SurfaceCard title="Widget Updates" subtitle="Live widget actions and manual trigger targets.">
    <div class="mb-4 flex flex-wrap gap-2">
      {#if data.canOperate}
      {#each data.triggerableWidgets as widget}
        <form method="POST" action="?/trigger">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <input type="hidden" name="instanceId" value={widget.instanceId} />
          <input type="hidden" name="widgetId" value={widget.widgetId} />
          <input type="hidden" name="action" value="manual-trigger" />
          <button
            class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
            type="submit"
            disabled={!selectedSession}
          >
            {widget.name}
          </button>
        </form>
      {/each}
      {/if}
    </div>
    <div class="space-y-3">
      {#each $widgetUpdates as update}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
          <p class="font-semibold">{widgetTitle(update)}</p>
          <p class="mt-1 text-slate-400">{update.action ?? update.triggerType ?? 'binding update'}</p>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No widget updates have been received.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Window Manager" subtitle="Operator-only runtime move/resize controls. Changes persist to the participant layout.">
    {#if windowUpdateStatus}
      <p class="mb-3 rounded-xl border px-3 py-2 text-sm {windowUpdateStatus.ok ? 'border-emerald-600/40 bg-emerald-950/40 text-emerald-200' : 'border-red-600/40 bg-red-950/40 text-red-200'}">
        {windowUpdateStatus.message}
      </p>
    {/if}
    <div class="space-y-3">
      {#each windowDrafts as entry}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="font-semibold">{entry.widgetId}</p>
            <span class="rounded-full border border-[--color-line] px-2 py-0.5 text-xs">{entry.mode === 'browser_popup' ? 'Browser window' : 'Electron transparent'}</span>
          </div>
          <div class="grid gap-2 md:grid-cols-4">
            <label class="text-xs text-slate-400">X
              <input class="mt-1 w-full rounded border border-[--color-line] bg-transparent px-2 py-1 text-sm" type="number" value={entry.x} oninput={(e) => updateDraft(entry.instanceId, { x: Number((e.currentTarget as HTMLInputElement).value || 0) })} />
            </label>
            <label class="text-xs text-slate-400">Y
              <input class="mt-1 w-full rounded border border-[--color-line] bg-transparent px-2 py-1 text-sm" type="number" value={entry.y} oninput={(e) => updateDraft(entry.instanceId, { y: Number((e.currentTarget as HTMLInputElement).value || 0) })} />
            </label>
            <label class="text-xs text-slate-400">W
              <input class="mt-1 w-full rounded border border-[--color-line] bg-transparent px-2 py-1 text-sm" type="number" value={entry.width} oninput={(e) => updateDraft(entry.instanceId, { width: Math.max(1, Number((e.currentTarget as HTMLInputElement).value || 1)) })} />
            </label>
            <label class="text-xs text-slate-400">H
              <input class="mt-1 w-full rounded border border-[--color-line] bg-transparent px-2 py-1 text-sm" type="number" value={entry.height} oninput={(e) => updateDraft(entry.instanceId, { height: Math.max(1, Number((e.currentTarget as HTMLInputElement).value || 1)) })} />
            </label>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => nudgeWindow(entry, -10, 0)}>←10</button>
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => nudgeWindow(entry, 10, 0)}>10→</button>
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => nudgeWindow(entry, 0, -10)}>↑10</button>
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => nudgeWindow(entry, 0, 10)}>↓10</button>
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => resizeWindow(entry, 20, 20)}>+20 size</button>
            <button type="button" class="rounded-lg border border-[--color-line] px-2 py-1 text-xs" onclick={() => resizeWindow(entry, -20, -20)}>-20 size</button>
            {#if data.canOperate}
              <button type="button" class="rounded-lg border border-[--color-line] bg-[--color-panel-soft] px-3 py-1 text-xs font-semibold" onclick={() => applyWindowUpdate(entry.instanceId)}>Apply</button>
            {/if}
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No widget windows in participant layout.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
  <SurfaceCard title="Sensor Status" subtitle="Latest sensor health events received through the realtime channel.">
    <div class="space-y-3">
      {#each $sensorStatus as status}
        <div class="scarline-list-item">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-semibold">{sensorTitle(status)}</p>
              <p class="mt-1 text-sm text-slate-400">{status.message ?? status.status ?? 'No message'}</p>
            </div>
            <StatusBadge status={String(status.status ?? 'unknown')} />
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">Waiting for sensor status events.</p>
      {/each}
    </div>
  </SurfaceCard>

  <SurfaceCard title="Operator Notes" subtitle="Timestamped session notes are saved to the selected session.">
    <form class="grid gap-3" method="POST" action="?/note">
      <input type="hidden" name="sessionId" value={selectedSession} />
      <div class="flex gap-2">
        <textarea
          name="note"
          bind:value={noteText}
          class="min-h-20 flex-1 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm"
          placeholder="Enter observation and press Add Note…"
          onkeydown={handleNoteKeydown}
        ></textarea>
      </div>
      <button
        class="rounded-2xl border border-[--color-line] px-4 py-2 text-sm font-medium"
        disabled={!noteText.trim() || !selectedSession}
        type="submit"
      >Add Note (Ctrl+Enter)</button>
      {#if noteEntries.length > 0}
        <div class="space-y-2">
          {#each noteEntries as note}
            <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
              <p class="font-medium">{note.text}</p>
              <p class="mt-1 text-xs text-slate-500">{note.timestamp}</p>
            </div>
          {/each}
        </div>
      {/if}
    </form>
  </SurfaceCard>
</div>

<style>
  .telemetry-chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.625rem;
  }
  .telemetry-tile {
    border: 1px solid var(--scarline-border);
    border-radius: 0.875rem;
    background: linear-gradient(180deg, #ffffff 0%, #f7f7f7 100%);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .telemetry-tile__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .telemetry-tile__label {
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--scarline-black-60);
  }
  .telemetry-tile__value {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--scarline-black);
    font-variant-numeric: tabular-nums;
  }
  .telemetry-tile__value small { font-size: 0.5em; font-weight: 400; opacity: 0.6; }
  .telemetry-tile__chart {
    overflow: hidden;
    border-radius: 0.25rem;
    height: 32px;
    display: flex;
    align-items: center;
  }
  .telemetry-tile__chart--empty {
    font-size: 0.625rem;
    color: var(--scarline-black-60);
    justify-content: center;
  }

  @media (max-width: 767px) {
    .telemetry-chart-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

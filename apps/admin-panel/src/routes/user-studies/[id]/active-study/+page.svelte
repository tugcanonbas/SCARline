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
  const selectedSessionStatus = $derived(
    (data.sessions as SessionOption[]).find((session) => session.id === selectedSession)?.status ?? 'created'
  );

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
    return (payload.payload?.vehicle ?? payload.vehicle ?? payload.payload ?? payload) as Record<string, unknown>;
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
</script>

<PageHeader eyebrow="Operator" title="Active Study Controls" description="Realtime session supervision, telemetry inspection, and manual widget control for the current study." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/active-study`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Socket</p>
    <div class="mt-2"><StatusBadge status={$socketState} /></div>
    <p class="metric-card__hint">Subscribed to session, telemetry, widget, and sensor channels</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Selected Session</p>
    <p class="metric-card__value">{selectedSession ? 'Live' : 'None'}</p>
    <p class="metric-card__hint">{selectedSession || 'Select a session below'}</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Telemetry</p>
    <p class="metric-card__value">{Object.keys($telemetry).length ? 'On' : 'Idle'}</p>
    <p class="metric-card__hint">Latest vehicle payload state</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Widgets</p>
    <p class="metric-card__value">{data.widgets.length}</p>
    <p class="metric-card__hint">Manual trigger catalogue</p>
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
      <p>Layouts configured: <strong class="text-white">{data.layouts.length}</strong></p>
    </div>
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
    <p class="mt-4 text-sm text-slate-400">Session lifecycle controls are wired to CoreAPI command routes for operator execution.</p>
  </SurfaceCard>

  <SurfaceCard title="Live Telemetry" subtitle="Current vehicle values received from CoreAPI WebSocket fanout.">
    <KeyValueGrid
      items={[
        { label: 'Speed', value: vehicle(latestTelemetry).speed ?? 'No telemetry' },
        { label: 'Speed Limit', value: vehicle(latestTelemetry).speedLimit ?? 'Unknown' },
        { label: 'Throttle', value: vehicle(latestTelemetry).throttle ?? 0 },
        { label: 'Brake', value: vehicle(latestTelemetry).brake ?? 0 },
        { label: 'Steer', value: vehicle(latestTelemetry).steer ?? 0 },
        { label: 'Routing Key', value: latestTelemetry.routingKey ?? 'Waiting for stream' }
      ]}
    />
  </SurfaceCard>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
  <SurfaceCard title="Session Events" subtitle="Lifecycle and simulator events for the selected run.">
    <div class="timeline-list">
      {#each $sessionEvents as event}
        <div class="timeline-entry text-sm">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold text-white">{eventTitle(event)}</p>
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
    </div>
    <div class="space-y-3">
      {#each $widgetUpdates as update}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
          <p class="font-semibold text-white">{widgetTitle(update)}</p>
          <p class="mt-1 text-slate-400">{update.action ?? update.triggerType ?? 'binding update'}</p>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No widget updates have been received.</p>
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

  <SurfaceCard title="Operator Notes" subtitle="Visual note-taking affordance; persistence remains in the existing session/log flows.">
    <label class="grid gap-2 text-sm">
      <span>Run note</span>
      <textarea disabled class="min-h-32 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" placeholder="Notes are captured by the implemented session/log flows."></textarea>
    </label>
  </SurfaceCard>
</div>

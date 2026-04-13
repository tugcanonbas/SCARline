<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { createRealtimeStore } from '$lib/stores/realtime';

  let { data } = $props();

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
    socketState,
    connect,
    disconnect
  } = live;
  const runningSessionId = $derived(
    (data.sessions as SessionOption[]).find((session) => session.status === 'running')?.id ?? ''
  );
  let selectedSession = $state('');

  $effect(() => {
    if (!selectedSession && runningSessionId) {
      selectedSession = runningSessionId;
    }
  });

  $effect(() => {
    connect(data.token, ['session.events', 'session.telemetry', 'widget.updates', 'sensor.status']);
    return () => disconnect();
  });

  function vehicle(payload: Record<string, unknown>) {
    return (payload.vehicle ?? payload) as Record<string, unknown>;
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
</script>

<PageHeader eyebrow="Operator" title="Active Study Controls" description="Realtime session supervision, telemetry inspection, and manual widget control for the current study." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/active-study`} />

<div class="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
  <SurfaceCard title="Session Context">
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
  </SurfaceCard>

  <SurfaceCard title="Live Telemetry">
    <KeyValueGrid
      items={[
        { label: 'Speed', value: vehicle($telemetry).speed ?? 'No telemetry' },
        { label: 'Speed Limit', value: vehicle($telemetry).speedLimit ?? 'Unknown' },
        { label: 'Throttle', value: vehicle($telemetry).throttle ?? 0 },
        { label: 'Brake', value: vehicle($telemetry).brake ?? 0 },
        { label: 'Steer', value: vehicle($telemetry).steer ?? 0 },
        { label: 'Routing Key', value: $telemetry.routingKey ?? 'Waiting for stream' }
      ]}
    />
  </SurfaceCard>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
  <SurfaceCard title="Session Events">
    <div class="space-y-3">
      {#each $sessionEvents as event}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
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
  <SurfaceCard title="Widget Updates">
    <div class="mb-4 flex flex-wrap gap-2">
      {#each data.widgets as widget}
        <span class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300">{widget.name}</span>
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

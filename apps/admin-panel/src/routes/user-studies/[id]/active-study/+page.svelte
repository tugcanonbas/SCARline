<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
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
      <p>Realtime socket state: <strong class="text-white">{$socketState}</strong></p>
      <p>Layouts configured: <strong class="text-white">{data.layouts.length}</strong></p>
    </div>
  </SurfaceCard>

  <SurfaceCard title="Live Telemetry">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify($telemetry, null, 2)}</pre>
  </SurfaceCard>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
  <SurfaceCard title="Session Events">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify($sessionEvents, null, 2)}</pre>
  </SurfaceCard>
  <SurfaceCard title="Widget Updates">
    <div class="mb-4 flex flex-wrap gap-2">
      {#each data.widgets as widget}
        <span class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300">{widget.name}</span>
      {/each}
    </div>
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify($widgetUpdates, null, 2)}</pre>
  </SurfaceCard>
</div>

<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const modalityCount = $derived(new Set(data.logs.map((entry: Record<string, unknown>) => entry.modality ?? 'unknown')).size);
  const sourceCount = $derived(new Set(data.logs.map((entry: Record<string, unknown>) => entry.source ?? 'unknown')).size);
</script>

<PageHeader
  eyebrow="Evidence"
  title="Session Logs"
  description="Browse persisted session events with filters for study, session, event type, and telemetry modality."
/>

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Visible Events</p>
    <p class="metric-card__value">{data.logs.length}</p>
    <p class="metric-card__hint">Current filtered result set</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Studies</p>
    <p class="metric-card__value">{data.studies.length}</p>
    <p class="metric-card__hint">Available study filters</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Modalities</p>
    <p class="metric-card__value">{modalityCount}</p>
    <p class="metric-card__hint">Modalities in current result</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Sources</p>
    <p class="metric-card__value">{sourceCount}</p>
    <p class="metric-card__hint">Event producers represented</p>
  </div>
</div>

<div class="mt-4">
<SurfaceCard title="Filters" subtitle="Filter the persisted event stream without changing the underlying query contract.">
  <form class="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_0.6fr_auto]" method="GET">
    <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="studyId">
      <option value="">All studies</option>
      {#each data.studies as study}
        <option value={study.id} selected={data.filters.studyId === study.id}>{study.name}</option>
      {/each}
    </select>
    <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="sessionId" placeholder="Session UUID" value={data.filters.sessionId} />
    <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="eventType" placeholder="Event type" value={data.filters.eventType} />
    <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="modality" placeholder="Modality" value={data.filters.modality} />
    <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" min="1" max="500" name="limit" type="number" value={data.filters.limit} />
    <button class="rounded-2xl border border-[--color-line] px-4 py-3 text-sm" type="submit">Apply</button>
  </form>
</SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Event Timeline" subtitle="Timeline-like view of persisted events; open a row for session-level detail.">
    <div class="timeline-list">
      {#each data.logs as entry}
        <a class="timeline-entry block transition hover:border-[--color-accent]/40" href={appPath(`/session-logs/${entry.sessionId ?? entry.session_id}`)}>
          <div class="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{entry.eventType ?? entry.event_type}</p>
              <p class="text-sm text-slate-400">{entry.modality} · {entry.source}</p>
            </div>
            <p class="text-xs text-slate-500">{entry.timestamp}</p>
          </div>
          <p class="truncate text-xs text-slate-400">{entry.routingKey ?? entry.routing_key}</p>
        </a>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No events match the current filters.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

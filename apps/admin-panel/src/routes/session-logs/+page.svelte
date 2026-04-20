<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
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
  <MetricCard label="Visible Events" value={data.logs.length} hint="Current filtered result set" accent />
  <MetricCard label="Studies" value={data.studies.length} hint="Available study filters" />
  <MetricCard label="Modalities" value={modalityCount} hint="Modalities in current result" />
  <MetricCard label="Sources" value={sourceCount} hint="Event producers represented" />
</div>

<div class="mt-4">
<SurfaceCard title="Filters" subtitle="Filter the persisted event stream without changing the underlying query contract.">
  <form class="filter-bar filter-bar--6" method="GET">
    <select name="studyId">
      <option value="">All studies</option>
      {#each data.studies as study}
        <option value={study.id} selected={data.filters.studyId === study.id}>{study.name}</option>
      {/each}
    </select>
    <input name="sessionId" placeholder="Session UUID" value={data.filters.sessionId} />
    <input name="eventType" placeholder="Event type" value={data.filters.eventType} />
    <input name="modality" placeholder="Modality" value={data.filters.modality} />
    <input min="1" max="500" name="limit" type="number" value={data.filters.limit} />
    <button class="button-secondary" type="submit">Apply</button>
  </form>
</SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Event Timeline" subtitle="Timeline-like view of persisted events; open a row for session-level detail.">
    <div class="timeline-list">
      {#each data.logs as entry}
        <a class="timeline-entry block" href={appPath(`/session-logs/${entry.sessionId ?? entry.session_id}`)}>
          <div class="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold">{entry.eventType ?? entry.event_type}</p>
              <p class="entity-card__meta">{entry.modality} · {entry.source}</p>
            </div>
            <p class="entity-card__meta">{entry.timestamp}</p>
          </div>
          <p class="truncate entity-card__meta">{entry.routingKey ?? entry.routing_key}</p>
        </a>
      {:else}
        <EmptyState message="No events match the current filters." />
      {/each}
    </div>
  </SurfaceCard>
</div>

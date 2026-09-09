<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import FilterBar from "$lib/components/FilterBar.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StudyFilterSelect from "$lib/components/StudyFilterSelect.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate } from "$lib/format";
  import { Filter } from "lucide-svelte";

  let { data } = $props();

  function formatBytes(value: unknown) {
    const bytes = Math.max(0, Number(value ?? 0));
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
</script>

<PageHeader
  eyebrow=""
  title="Session Logs"
  description="View and filter session events."
/>

<div class="metric-grid">
  <MetricCard
    label="Active Studies"
    value={data.aggregates.activeStudyCount}
    hint="Active studies matching the filters"
  />
  <MetricCard
    label="Total Sessions"
    value={data.aggregates.sessionCount}
    hint="Unique sessions matching the filters"
  />
  <MetricCard
    label="Total Data Size"
    value={formatBytes(data.aggregates.storedPayloadBytes)}
    hint="Stored payload size matching the filters"
  />
  <MetricCard
    label="Total Records"
    value={data.aggregates.eventCount}
    hint="Events matching the filters"
  />
</div>

<div class="mt-4">
  <SurfaceCard title="Sessions" subtitle="Find and manage sessions.">
    <form class="flex flex-col gap-4" method="GET">
      <FilterBar fieldCount={5}>
        <StudyFilterSelect studies={data.studies} value={data.filters.studyId} />
        <input
          class="w-full"
          style="width: 100%;"
          name="sessionId"
          placeholder="Session ID"
          value={data.filters.sessionId}
        />
        <input
          class="w-full"
          style="width: 100%;"
          name="eventType"
          placeholder="Event type"
          value={data.filters.eventType}
        />
        <input
          class="w-full"
          style="width: 100%;"
          name="modality"
          placeholder="Modality"
          value={data.filters.modality}
        />
        <input
          class="w-full"
          style="width: 100%;"
          min="1"
          max="500"
          name="limit"
          type="number"
          value={data.filters.limit}
        />
        <button class="button-primary" type="submit"
          ><Filter size={24} strokeWidth={1.5} /> Filter</button
        >
      </FilterBar>
      <div class="flex items-center justify-end gap-4 mt-2">
        <span class="entity-card__meta">{data.logs.length} shown · {data.aggregates.eventCount} total</span>
      </div>
    </form>
    <div class="timeline-list mt-4">
      {#each data.logs as entry}
        <a
          class="timeline-entry block"
          href={appPath(`/session-logs/${entry.sessionId ?? entry.session_id}`)}
        >
          <div
            class="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <p class="font-semibold">{entry.eventType ?? entry.event_type}</p>
              <p class="entity-card__meta">
                {entry.modality} · {entry.sourceKey ?? entry.sourceType ?? "Unknown source"}
              </p>
            </div>
            <p class="entity-card__meta">{formatDate(entry.timestamp)}</p>
          </div>
        </a>
      {:else}
        <EmptyState message="No events match the current filters." />
      {/each}
    </div>
    {#if data.nextQuery}
      <div class="form-actions mt-4">
        <a class="button-secondary" href={appPath(`/session-logs?${data.nextQuery}`)}>Next Page</a>
      </div>
    {/if}
  </SurfaceCard>
</div>

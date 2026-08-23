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
  const activeStudiesCount = $derived(
    data.studies.filter(
      (s: Record<string, unknown>) =>
        s.status === "active" || s.status === "ACTIVE",
    ).length || data.studies.length,
  );

  const totalSessionsCount = $derived(
    new Set(
      data.logs
        .map(
          (entry: Record<string, unknown>) =>
            entry.sessionId ?? entry.session_id,
        )
        .filter(Boolean),
    ).size,
  );

  const totalRecordsCount = $derived(data.logs.length);
</script>

<PageHeader
  eyebrow=""
  title="Session Logs"
  description="View and filter session events."
/>

<div class="metric-grid">
  <MetricCard
    label="Active Studies"
    value={activeStudiesCount}
    hint="Currently active studies"
  />
  <MetricCard
    label="Total Sessions"
    value={totalSessionsCount}
    hint="Unique sessions in view"
  />
  <MetricCard
    label="Total Data Size"
    value="Not available"
    hint="Requires a backend aggregate endpoint (not yet implemented)"
  />
  <MetricCard
    label="Total Records"
    value={totalRecordsCount}
    hint="Visible events"
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
        <span class="entity-card__meta">{data.logs.length} results</span>
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
              <p class="entity-card__meta">{entry.modality} · {entry.source}</p>
            </div>
            <p class="entity-card__meta">{formatDate(entry.timestamp)}</p>
          </div>
        </a>
      {:else}
        <EmptyState message="No events match the current filters." />
      {/each}
    </div>
  </SurfaceCard>
</div>

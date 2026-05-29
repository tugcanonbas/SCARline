<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
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

  // Note: Total data size is mocked here as it requires a backend aggregate endpoint
  const totalDataSize = "1.4 GB";
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
    value={totalDataSize}
    hint="Estimated size on disk"
  />
  <MetricCard
    label="Total Records"
    value={totalRecordsCount}
    hint="Visible events"
  />
</div>

<div class="mt-4">
  <SurfaceCard
    title="Filters"
    subtitle="Filter the persisted event stream without changing the underlying query contract."
  >
    <form class="flex flex-col gap-4" method="GET">
      <div class="filter-bar filter-bar--5">
        <select class="w-full" style="width: 100%;" name="studyId">
          <option value="">All studies</option>
          {#each data.studies as study}
            <option
              value={study.id}
              selected={data.filters.studyId === study.id}>{study.name}</option
            >
          {/each}
        </select>
        <input
          class="w-full"
          style="width: 100%;"
          name="sessionId"
          placeholder="Session UUID"
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
      </div>
      <div class="flex items-center justify-end gap-4 mt-2">
        <button class="button-primary" type="submit"
          ><Filter size={24} strokeWidth={1.5} /> Filter</button
        >
      </div>
      <div class="flex items-center justify-end gap-4 mt-2">
        <span class="entity-card__meta">{data.logs.length} results</span>
      </div>
    </form>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard
    title="Event Timeline"
    subtitle="Timeline-like view of persisted events; open a row for session-level detail."
  >
    <div class="timeline-list">
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
            <p class="entity-card__meta">{entry.timestamp}</p>
          </div>
          <p class="truncate entity-card__meta">
            {entry.routingKey ?? entry.routing_key}
          </p>
        </a>
      {:else}
        <EmptyState message="No events match the current filters." />
      {/each}
    </div>
  </SurfaceCard>
</div>

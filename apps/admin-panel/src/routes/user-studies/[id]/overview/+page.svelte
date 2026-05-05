<script lang="ts">
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { Users, TestTubeDiagonal, Database } from "lucide-svelte";

  let { data } = $props();
  const participantCount = $derived(
    data.study.participantCount ?? data.study.participant_count ?? 0,
  );
  const conditionCount = $derived(
    data.study.conditionCount ?? data.study.condition_count ?? 0,
  );
  const sessionCount = $derived(
    data.study.sessionCount ?? data.study.session_count ?? 0,
  );
  const updatedAt = $derived(
    data.study.updatedAt ?? data.study.updated_at ?? "Unknown",
  );

  let showChecklist = $state(true);
</script>

<PageHeader
  eyebrow="Study"
  title={data.study.name}
  description={data.study.description ?? "No description"}
>
  {#snippet actions()}
    <div class="action-strip">
      <a
        class="button-primary"
        href={appPath(`/user-studies/${data.study.id}/sessions`)}
      >
        <Database size={24} strokeWidth={1.5} />
        New Session
      </a>
    </div>
  {/snippet}
</PageHeader>
<StudyTabs
  studyId={data.study.id}
  current={`/user-studies/${data.study.id}/overview`}
/>

<div class="metric-grid">
  <MetricCard
    label="Participants"
    value={participantCount}
    hint="Participants in the study"
    href={appPath(`/user-studies/${data.study.id}/participants`)}
    hrefText="Manage"
    icon={Users}
  />
  <MetricCard
    label="Study conditions"
    value={conditionCount}
    hint="Experimental variants of the study"
    href={appPath(`/user-studies/${data.study.id}/conditions`)}
    hrefText="Adjust"
    icon={TestTubeDiagonal}
  />
  <MetricCard
    label="Sessions"
    value={sessionCount}
    hint="Study sessions"
    href={appPath(`/user-studies/${data.study.id}/sessions`)}
    hrefText="New Session"
    icon={Database}
  />
  <MetricCard label="Status" hint={`Last update: ${updatedAt}`}>
    {#snippet valueContent()}
      <div class="metric-card__content">
        <StatusBadge status={data.study.status} />
      </div>
    {/snippet}
  </MetricCard>
</div>

{#if showChecklist}
  <div class="mt-4 section-grid" id="checklist">
    <SurfaceCard title="Quick Start" subtitle="Steps to get you started.">
      <div class="metric-grid">
        <a
          class="entity-card entity-card--tight"
          href={appPath(`/user-studies/${data.study.id}/participants`)}
        >
          <p class="entity-card__title">1. Register participants</p>
          <p class="entity-card__meta">
            {participantCount} participant records available
          </p>
        </a>
        <a
          class="entity-card entity-card--tight"
          href={appPath(`/user-studies/${data.study.id}/conditions`)}
        >
          <p class="entity-card__title">2. Define conditions</p>
          <p class="entity-card__meta">
            {conditionCount} condition variants configured
          </p>
        </a>
        <a
          class="entity-card entity-card--tight"
          href={appPath(`/user-studies/${data.study.id}/carla-config`)}
        >
          <p class="entity-card__title">3. Configure simulator</p>
          <p class="entity-card__meta">
            Map, weather, ego vehicle, traffic, and sensor baseline
          </p>
        </a>
        <a
          class="entity-card entity-card--tight"
          href={appPath(`/user-studies/${data.study.id}/participant-view`)}
        >
          <p class="entity-card__title">4. Prepare overlay layout</p>
          <p class="entity-card__meta">
            Participant-facing widget composition and hidden states
          </p>
        </a>
      </div>
      <div class="mt-2">
        <button
          class="button-secondary"
          onclick={() => {
            showChecklist = false;
          }}>Hide Checklist</button
        >
      </div>
    </SurfaceCard>
  </div>
{/if}

<div class="mt-4 section-grid">
  <SurfaceCard title="Study Information" subtitle="">
    <div class="kv-item mb-4">
      <div class="kv-label">Description</div>
      <p class="kv-value">{data.study.description ?? "No description"}</p>
    </div>
    <div class="kv-grid">
      <div class="kv-item">
        <div class="kv-label">Status</div>
        <p class="kv-value">{data.study.status}</p>
      </div>
      <div class="kv-item">
        <div class="kv-label">Created</div>
        <p class="kv-value">
          {data.study.created_at ?? "Unknown"} by {data.study.created_by ??
            "Unknown"}
        </p>
      </div>
      <div class="kv-item">
        <div class="kv-label">Last Update</div>
        <p class="kv-value">{data.study.updated_at ?? "Unknown"}</p>
      </div>
    </div>
  </SurfaceCard>
</div>

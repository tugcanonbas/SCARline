<script lang="ts">
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { Users } from "lucide-svelte";

  let { data } = $props();
  const studyItems = $derived([
    { label: "Status", value: data.study.status },
    { label: "Version", value: data.study.version ?? "1" },
    {
      label: "Participants",
      value: data.study.participantCount ?? data.study.participant_count ?? 0,
    },
    {
      label: "Created",
      value: data.study.createdAt ?? data.study.created_at ?? "Unknown",
    },
    {
      label: "Updated",
      value: data.study.updatedAt ?? data.study.updated_at ?? "Unknown",
    },
    {
      label: "Owner",
      value: data.study.createdBy ?? data.study.created_by ?? "Not assigned",
    },
  ]);
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
</script>

<PageHeader
  eyebrow="Study"
  title={data.study.name}
  description={data.study.description ?? ""}
></PageHeader>
<StudyTabs
  studyId={data.study.id}
  current={`/user-studies/${data.study.id}/overview`}
/>

<div class="metric-grid">
  <MetricCard
    label="Participants"
    value={participantCount}
    href={appPath(`/user-studies/${data.study.id}/participants`)}
    hrefText="Manage"
    icon={Users}
  />
  <MetricCard
    label="Conditions"
    value={conditionCount}
    hint="Experimental variants"
  />
  <MetricCard
    label="Sessions"
    value={sessionCount}
    hint="Created session records"
  />
  <MetricCard label="Study State" hint={`Last update: ${updatedAt}`}>
    {#snippet valueContent()}
      <div class="metric-card__content">
        <StatusBadge status={data.study.status} />
      </div>
    {/snippet}
  </MetricCard>
</div>

<div class="mt-4 section-grid section-grid--sidebar">
  <SurfaceCard
    title="Study Snapshot"
    subtitle="Canonical study metadata from CoreAPI."
  >
    <KeyValueGrid items={studyItems} />
  </SurfaceCard>

  <SurfaceCard
    title="Setup Checklist"
    subtitle="Use the existing study sections to complete operator readiness."
  >
    <div class="list-stack">
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
  </SurfaceCard>
</div>

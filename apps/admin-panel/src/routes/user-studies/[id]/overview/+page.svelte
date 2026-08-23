<script lang="ts">
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate, formatStatusLabel } from "$lib/format";
  import { STUDY_SECTIONS, studySectionHref } from "$lib/studySections";
  import { Users, TestTubeDiagonal, Database, CirclePlay } from "lucide-svelte";

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
    formatDate(data.study.updatedAt ?? data.study.updated_at),
  );
  const createdAt = $derived(formatDate(data.study.created_at));

  // Only opened by default for a study that hasn't been set up yet — once
  // participants, conditions, or sessions exist, this stays collapsed
  // (though it's always reopenable via its summary) instead of permanently
  // duplicating the tab bar's navigation.
  const isNewStudy = $derived(
    participantCount === 0 && conditionCount === 0 && sessionCount === 0,
  );
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
        <CirclePlay size={24} strokeWidth={1.5} />
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
    label={STUDY_SECTIONS.participants.label}
    value={participantCount}
    hint="Participants in the study"
    href={appPath(`/user-studies/${data.study.id}/participants`)}
    hrefText="Manage"
    icon={Users}
  />
  <MetricCard
    label={STUDY_SECTIONS.conditions.label}
    value={conditionCount}
    hint="Experimental variants of the study"
    href={appPath(`/user-studies/${data.study.id}/conditions`)}
    hrefText="Adjust"
    icon={TestTubeDiagonal}
  />
  <MetricCard
    label={STUDY_SECTIONS.sessions.label}
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

<details class="surface-card mt-4" id="checklist" open={isNewStudy}>
  <summary class="surface-card__title" style="cursor: pointer;"
    >Quick Start — steps to get you started</summary
  >
  <div class="surface-card__body mt-4">
    <div class="metric-grid">
      <a
        class="entity-card entity-card--tight"
        href={appPath(studySectionHref(data.study.id, "participants"))}
      >
        <p class="entity-card__title">
          1. {STUDY_SECTIONS.participants.label}
        </p>
        <p class="entity-card__meta">
          Add and configure new participants. Currently
          {participantCount} participant{participantCount === 1 ? "" : "s"} available.
        </p>
      </a>
      <a
        class="entity-card entity-card--tight"
        href={appPath(studySectionHref(data.study.id, "conditions"))}
      >
        <p class="entity-card__title">
          2. {STUDY_SECTIONS.conditions.label}
        </p>
        <p class="entity-card__meta">
          Configure experimental conditions. Currently {conditionCount} condition{conditionCount ===
          1
            ? ""
            : "s"} configured.
        </p>
      </a>
      <a
        class="entity-card entity-card--tight"
        href={appPath(studySectionHref(data.study.id, "simulator"))}
      >
        <p class="entity-card__title">
          3. {STUDY_SECTIONS.simulator.label}
        </p>
        <p class="entity-card__meta">
          Set up the simulator, including map, weather, vehicle, traffic, and
          default sensors (default simulator: CARLA).
        </p>
      </a>
      <a
        class="entity-card entity-card--tight"
        href={appPath(studySectionHref(data.study.id, "sensors"))}
      >
        <p class="entity-card__title">4. {STUDY_SECTIONS.sensors.label}</p>
        <p class="entity-card__meta">
          Choose which hardware sensors this study records from.
        </p>
      </a>
      <a
        class="entity-card entity-card--tight"
        href={appPath(studySectionHref(data.study.id, "participant-view"))}
      >
        <p class="entity-card__title">
          5. {STUDY_SECTIONS["participant-view"].label}
        </p>
        <p class="entity-card__meta">
          Design what participants see on their display during a session.
        </p>
      </a>
    </div>
  </div>
</details>

<div class="mt-4 section-grid">
  <SurfaceCard title="Study Information" subtitle="">
    <div class="kv-item mb-4">
      <div class="kv-label">Description</div>
      <p class="kv-value">{data.study.description ?? "No description"}</p>
    </div>
    <div class="kv-grid">
      <div class="kv-item">
        <div class="kv-label">Status</div>
        <p class="kv-value">{formatStatusLabel(data.study.status)}</p>
      </div>
      <div class="kv-item">
        <div class="kv-label">Created</div>
        <p class="kv-value">
          {createdAt}{data.study.created_by
            ? ` by ${data.study.created_by}`
            : ""}
        </p>
      </div>
      <div class="kv-item">
        <div class="kv-label">Last Update</div>
        <p class="kv-value">{updatedAt}</p>
      </div>
    </div>
  </SurfaceCard>
</div>

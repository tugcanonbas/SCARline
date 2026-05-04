<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Plus, ArrowRight } from "lucide-svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";

  let { data } = $props();
  type StudyListItem = {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    participantCount?: number | null;
  };

  const activeStudies = $derived(
    data.studies.filter((study: StudyListItem) => study.status === "active")
      .length,
  );
  const draftStudies = $derived(
    data.studies.filter((study: StudyListItem) => study.status === "draft")
      .length,
  );
  const totalParticipants = $derived(
    data.studies.reduce(
      (sum: number, study: StudyListItem) =>
        sum + Number(study.participantCount ?? 0),
      0,
    ),
  );
</script>

<PageHeader
  eyebrow="Research Design"
  title="User Studies"
  description="View and set up your user studies and jump into a session."
>
  {#snippet actions()}
    {#if data.canManage}
      <a class="button-primary" href={appPath("/user-studies/new")}>
        <Plus size={24} strokeWidth={1.5} />
        New Study
      </a>
    {/if}
  {/snippet}
</PageHeader>

<div class="study-data">
  <div>{activeStudies} active studies</div>
  <span>|</span>
  <div>{draftStudies} draft studies</div>
  <span>|</span>
  <div>{totalParticipants} participants</div>
</div>

<div class="list-stack study-list">
  {#each data.studies as study}
    <section class="entity-card">
      <div class="entity-card__header">
        <div class="min-w-0">
          <p class="entity-card__title">{study.name}</p>
          <p class="entity-card__meta">
            {study.description ?? "No description"}
          </p>
        </div>

        <div class="pill-row">
          <StatusBadge status={study.status} />
          <span class="status-badge status-badge--muted"
            >{study.participantCount} participants</span
          >
        </div>
      </div>

      <div class="section-grid">
        <div class="detail-grid-3">
          <div class="technical-panel">
            <p class="technical-label">Overview</p>
            <p class="technical-value">
              Study summary, setup checklist, and current readiness.
            </p>
          </div>
          <div class="technical-panel">
            <p class="technical-label">Configuration</p>
            <p class="technical-value">
              Participants, conditions, simulator config, and sensors.
            </p>
          </div>
          <div class="technical-panel">
            <p class="technical-label">Operations</p>
            <p class="technical-value">
              Session queue, active controls, and participant layout.
            </p>
          </div>
        </div>

        <div class="form-actions">
          <a
            class="button-primary"
            href={appPath(`/user-studies/${study.id}/overview`)}
          >
            View <ArrowRight size={24} strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </section>
  {:else}
    <EmptyState
      message="No studies yet. Create a study to start configuring conditions, layouts, and sessions."
    />
  {/each}
</div>

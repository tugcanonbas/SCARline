<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Plus, ArrowRight } from "lucide-svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { STUDY_DESIGN_ACCESS_REQUIRED } from "$lib/permissions";

  let { data } = $props();
  type StudyListItem = {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    participantCount?: number | null;
  };

  const activeStudies = $derived(
    data.studies.filter((study: StudyListItem) =>
      ["configured", "ready", "running"].includes(study.status),
    ).length,
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
    {:else}
      <button
        class="button-primary"
        type="button"
        disabled
        title={STUDY_DESIGN_ACCESS_REQUIRED}
      >
        <Plus size={24} strokeWidth={1.5} />
        New Study
      </button>
    {/if}
  {/snippet}
</PageHeader>

<div class="list-stack study-list">
  {#each data.studies as study}
    <a class="entity-card" href={appPath(`/user-studies/${study.id}/overview`)}>
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
            >{study.participantCount} participant{study.participantCount === 1
              ? ""
              : "s"}</span
          >
        </div>
      </div>
    </a>
  {:else}
    <EmptyState
      message="No studies yet. Create a study to start configuring conditions, layouts, and sessions."
    />
  {/each}
</div>

<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  let { data } = $props();
  type StudyListItem = {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    participantCount?: number | null;
  };

  const activeStudies = $derived(
    data.studies.filter((study: StudyListItem) => study.status === 'active').length,
  );
  const draftStudies = $derived(
    data.studies.filter((study: StudyListItem) => study.status === 'draft').length,
  );
  const totalParticipants = $derived(
    data.studies.reduce(
      (sum: number, study: StudyListItem) =>
        sum + Number(study.participantCount ?? 0),
      0,
    )
  );
</script>

<PageHeader eyebrow="Research Design" title="User Studies" description="Milestone-1 study list with direct navigation into configuration and active controls.">
  {#snippet actions()}
    {#if data.canManage}
      <a class="button-primary" href={appPath('/user-studies/new')}>New Study</a>
    {/if}
  {/snippet}
</PageHeader>

<div class="metric-grid">
  <MetricCard label="Study Catalogue" value={data.studies.length} hint="Available study workspaces" accent />
  <MetricCard label="Active Studies" value={activeStudies} hint="Studies currently ready for live operation" />
  <MetricCard label="Draft Studies" value={draftStudies} hint="Still being configured before operator use" />
  <MetricCard label="Participants" value={totalParticipants} hint="Total participant records across studies" />
</div>

<SurfaceCard title="Studies">
  <div class="list-stack">
    {#each data.studies as study}
      <section class="entity-card">
        <div class="entity-card__header">
          <div class="min-w-0">
            <p class="entity-card__title">{study.name}</p>
            <p class="entity-card__meta">{study.description ?? 'No description'}</p>
          </div>

          <div class="pill-row">
            <StatusBadge status={study.status} />
            <span class="status-badge status-badge--muted">{study.participantCount} participants</span>
          </div>
        </div>

        <div class="section-grid">
          <div class="detail-grid-3">
            <div class="technical-panel">
              <p class="technical-label">Overview</p>
              <p class="technical-value">Study summary, setup checklist, and current readiness.</p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Configuration</p>
              <p class="technical-value">Participants, conditions, simulator config, and sensors.</p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Operations</p>
              <p class="technical-value">Session queue, active controls, and participant layout.</p>
            </div>
          </div>

          <div class="form-actions">
            <a class="button-secondary" href={appPath(`/user-studies/${study.id}/overview`)}>Overview</a>
            <a class="button-secondary" href={appPath(`/user-studies/${study.id}/participants`)}>Participants</a>
            <a class="button-secondary" href={appPath(`/user-studies/${study.id}/sessions`)}>Sessions</a>
            <a class="button-primary" href={appPath(`/user-studies/${study.id}/active-study`)}>Active Study</a>
          </div>
        </div>
      </section>
    {:else}
      <EmptyState message="No studies yet. Create a study to start configuring conditions, layouts, and sessions." />
    {/each}
  </div>
</SurfaceCard>

<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  let { data } = $props();

  const activeStudies = $derived(data.studies.filter((study) => study.status === 'active').length);
  const draftStudies = $derived(data.studies.filter((study) => study.status === 'draft').length);
  const totalParticipants = $derived(
    data.studies.reduce((sum, study) => sum + Number(study.participantCount ?? 0), 0)
  );
</script>

<PageHeader eyebrow="Research Design" title="User Studies" description="Milestone-1 study list with direct navigation into configuration and active controls.">
  {#snippet actions()}
    {#if data.canManage}
      <a class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" href={appPath('/user-studies/new')}>New Study</a>
    {/if}
  {/snippet}
</PageHeader>

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Study Catalogue</p>
    <p class="metric-card__value">{data.studies.length}</p>
    <p class="metric-card__hint">Available study workspaces</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Active Studies</p>
    <p class="metric-card__value">{activeStudies}</p>
    <p class="metric-card__hint">Studies currently ready for live operation</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Draft Studies</p>
    <p class="metric-card__value">{draftStudies}</p>
    <p class="metric-card__hint">Still being configured before operator use</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Participants</p>
    <p class="metric-card__value">{totalParticipants}</p>
    <p class="metric-card__hint">Total participant records across studies</p>
  </div>
</div>

<SurfaceCard title="Studies">
  <div class="grid gap-3">
    {#each data.studies as study}
      <section class="scarline-list-item grid gap-4">
        <div class="flex w-full flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-base font-bold leading-snug">{study.name}</p>
            <p class="mt-1 text-sm text-slate-500">{study.description ?? 'No description'}</p>
          </div>

          <div class="ml-auto shrink-0 flex flex-wrap items-center justify-end gap-2 text-sm">
            <StatusBadge status={study.status} />
            <span class="status-badge status-badge--soft">{study.participantCount} participants</span>
          </div>
        </div>

        <div class="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div class="grid gap-2 md:grid-cols-3">
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

          <div class="action-strip lg:justify-end">
            <a href={appPath(`/user-studies/${study.id}/overview`)}>Overview</a>
            <a href={appPath(`/user-studies/${study.id}/participants`)}>Participants</a>
            <a href={appPath(`/user-studies/${study.id}/sessions`)}>Sessions</a>
            <a href={appPath(`/user-studies/${study.id}/active-study`)}>Active Study</a>
          </div>
        </div>
      </section>
    {:else}
      <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-500">
        No studies yet. Create a study to start configuring conditions, layouts, and sessions.
      </p>
    {/each}
  </div>
</SurfaceCard>

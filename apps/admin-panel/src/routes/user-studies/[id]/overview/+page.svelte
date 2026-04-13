<script lang="ts">
  import { appPath } from '$lib/paths';
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const studyItems = $derived([
    { label: 'Status', value: data.study.status },
    { label: 'Version', value: data.study.version ?? '1' },
    { label: 'Participants', value: data.study.participantCount ?? data.study.participant_count ?? 0 },
    { label: 'Created', value: data.study.createdAt ?? data.study.created_at ?? 'Unknown' },
    { label: 'Updated', value: data.study.updatedAt ?? data.study.updated_at ?? 'Unknown' },
    { label: 'Owner', value: data.study.createdBy ?? data.study.created_by ?? 'Not assigned' }
  ]);
  const participantCount = $derived(data.study.participantCount ?? data.study.participant_count ?? 0);
  const conditionCount = $derived(data.study.conditionCount ?? data.study.condition_count ?? 0);
  const sessionCount = $derived(data.study.sessionCount ?? data.study.session_count ?? 0);
  const updatedAt = $derived(data.study.updatedAt ?? data.study.updated_at ?? 'Unknown');
</script>

<PageHeader eyebrow="Study" title={data.study.name} description={data.study.description ?? 'No description yet.'}>
  {#snippet actions()}
    <div class="action-strip">
      <a href={appPath(`/user-studies/${data.study.id}/sessions`)}>Open sessions</a>
      <a href={appPath(`/user-studies/${data.study.id}/participants`)}>Participants</a>
      <a href={appPath(`/user-studies/${data.study.id}/conditions`)}>Conditions</a>
      <a href={appPath(`/user-studies/${data.study.id}/active-study`)}>Operator view</a>
    </div>
  {/snippet}
</PageHeader>
<StudyTabs studyId={data.study.id} current={`/user-studies/${data.study.id}/overview`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Participants</p>
    <p class="metric-card__value">{participantCount}</p>
    <p class="metric-card__hint">Records attached to this study</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Conditions</p>
    <p class="metric-card__value">{conditionCount}</p>
    <p class="metric-card__hint">Experimental variants</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Sessions</p>
    <p class="metric-card__value">{sessionCount}</p>
    <p class="metric-card__hint">Created session records</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Study State</p>
    <div class="mt-2"><StatusBadge status={data.study.status} /></div>
    <p class="metric-card__hint">Last update: {updatedAt}</p>
  </div>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
  <SurfaceCard title="Study Snapshot" subtitle="Canonical study metadata from CoreAPI.">
    <KeyValueGrid items={studyItems} />
  </SurfaceCard>

  <SurfaceCard title="Setup Checklist" subtitle="Use the existing study sections to complete operator readiness.">
    <div class="space-y-3">
      <a class="scarline-list-item block" href={appPath(`/user-studies/${data.study.id}/participants`)}>
        <p class="font-semibold">1. Register participants</p>
        <p class="mt-1 text-sm text-slate-400">{participantCount} participant records available</p>
      </a>
      <a class="scarline-list-item block" href={appPath(`/user-studies/${data.study.id}/conditions`)}>
        <p class="font-semibold">2. Define conditions</p>
        <p class="mt-1 text-sm text-slate-400">{conditionCount} condition variants configured</p>
      </a>
      <a class="scarline-list-item block" href={appPath(`/user-studies/${data.study.id}/carla-config`)}>
        <p class="font-semibold">3. Configure simulator</p>
        <p class="mt-1 text-sm text-slate-400">Map, weather, ego vehicle, traffic, and sensor baseline</p>
      </a>
      <a class="scarline-list-item block" href={appPath(`/user-studies/${data.study.id}/participant-view`)}>
        <p class="font-semibold">4. Prepare overlay layout</p>
        <p class="mt-1 text-sm text-slate-400">Participant-facing widget composition and hidden states</p>
      </a>
    </div>
  </SurfaceCard>
</div>

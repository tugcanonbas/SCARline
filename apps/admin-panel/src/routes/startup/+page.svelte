<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const healthItems = $derived(
    Object.entries(data.health ?? {}).map(([label, value]) => ({ label, value }))
  );
  const serviceCount = $derived(Object.keys(data.health ?? {}).length);
</script>

<div class="mx-auto max-w-4xl py-10">
  <PageHeader
    eyebrow="Startup"
    title="Platform bootstrap state"
    description="Use this page during service bring-up before operators switch to the main dashboard."
  />

  <div class="metric-grid">
    <div class="metric-card">
      <p class="metric-card__label">Bootstrap</p>
      <p class="metric-card__value">{data.bootstrap.onboardingCompleted ? 'Ready' : 'Setup'}</p>
      <p class="metric-card__hint">{data.bootstrap.onboardingCompleted ? 'Onboarding has completed' : 'Onboarding is still required'}</p>
    </div>
    <div class="metric-card">
      <p class="metric-card__label">Health Keys</p>
      <p class="metric-card__value">{serviceCount}</p>
      <p class="metric-card__hint">Values returned by the health endpoint</p>
    </div>
    <div class="metric-card">
      <p class="metric-card__label">Polling</p>
      <p class="metric-card__value">Manual</p>
      <p class="metric-card__hint">Refresh this page to update the static loader snapshot</p>
    </div>
    <div class="metric-card">
      <p class="metric-card__label">Operator Path</p>
      <p class="metric-card__value">Admin</p>
      <p class="metric-card__hint">Continue to dashboard after services report ready</p>
    </div>
  </div>

  <div class="mt-4">
  <SurfaceCard title="Health Snapshot" subtitle="Visual startup status based on the current loader response.">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <StatusBadge status={data.health?.status ?? 'unknown'} />
      <StatusBadge status={data.bootstrap.onboardingCompleted ? 'healthy' : 'pending'} label={data.bootstrap.onboardingCompleted ? 'Onboarding complete' : 'Onboarding pending'} />
    </div>
    <div class="mb-4 h-3 rounded-2xl border border-[--color-line] bg-[--color-panel-soft]">
      <div class="h-full rounded-2xl bg-black" style={`width: ${data.bootstrap.onboardingCompleted ? 100 : 45}%`}></div>
    </div>
    <KeyValueGrid items={healthItems} />
  </SurfaceCard>
  </div>
</div>

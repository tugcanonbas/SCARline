<script lang="ts">
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
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

<div class="page-shell--wide py-10">
  <PageHeader
    eyebrow="Startup"
    title="Platform bootstrap state"
    description="Use this page during service bring-up before operators switch to the main dashboard."
  />

  <div class="metric-grid">
    <MetricCard label="Bootstrap" value={data.bootstrap.onboardingCompleted ? 'Ready' : 'Setup'} hint={data.bootstrap.onboardingCompleted ? 'Onboarding has completed' : 'Onboarding is still required'} accent />
    <MetricCard label="Health Keys" value={serviceCount} hint="Values returned by the health endpoint" />
    <MetricCard label="Polling" value="Manual" hint="Refresh this page to update the static loader snapshot" />
    <MetricCard label="Operator Path" value="Admin" hint="Continue to dashboard after services report ready" />
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

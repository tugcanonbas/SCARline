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
  const serviceCount = $derived(Array.isArray(data.health?.components) ? data.health.components.length : 0);
</script>

<div class="page-shell--wide py-10">
  <PageHeader
    eyebrow="Startup"
    title="Platform bootstrap state"
    description="Use this page during service bring-up before operators switch to the main dashboard."
  />

  <div class="metric-grid">
    <MetricCard label="Bootstrap" value={data.bootstrap.onboardingCompleted ? 'Ready' : 'Waiting'} hint={data.bootstrap.onboardingCompleted ? 'Platform readiness checks passed' : 'Platform readiness checks are still pending'} accent />
    <MetricCard label="Components" value={serviceCount} hint="Readiness components checked" />
    <MetricCard label="Polling" value="Manual" hint="Refresh this page to check the latest status" />
    <MetricCard label="Operator Path" value="Admin" hint="Continue to dashboard after services report ready" />
  </div>

  <div class="mt-4">
  <SurfaceCard title="Health Snapshot" subtitle="Real-time system startup and health status.">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <StatusBadge status={String(data.health?.status ?? 'unknown')} />
      <StatusBadge status={data.bootstrap.onboardingCompleted ? 'healthy' : 'pending'} label={data.bootstrap.onboardingCompleted ? 'Platform ready' : 'Readiness pending'} />
    </div>
    <KeyValueGrid items={healthItems} />
  </SurfaceCard>
  </div>
</div>

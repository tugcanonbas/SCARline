<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const healthItems = $derived(
    Object.entries(data.health ?? {}).map(([label, value]) => ({ label, value }))
  );
</script>

<div class="mx-auto max-w-4xl py-10">
  <PageHeader
    eyebrow="Startup"
    title="Platform bootstrap state"
    description="Use this page during service bring-up before operators switch to the main dashboard."
  />

  <SurfaceCard title="Health Snapshot">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <StatusBadge status={data.health?.status ?? 'unknown'} />
      <StatusBadge status={data.bootstrap.onboardingCompleted ? 'healthy' : 'pending'} label={data.bootstrap.onboardingCompleted ? 'Onboarding complete' : 'Onboarding pending'} />
    </div>
    <KeyValueGrid items={healthItems} />
  </SurfaceCard>
</div>

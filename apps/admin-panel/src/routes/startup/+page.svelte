<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<div class="mx-auto max-w-4xl py-10">
  <PageHeader
    eyebrow="Startup"
    title="Platform bootstrap state"
    description="Use this page during service bring-up before operators switch to the main dashboard."
  />

  <SurfaceCard title="Health Snapshot">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.health, null, 2)}</pre>
    <p class="mt-4 text-sm text-slate-400">
      Onboarding complete: <strong class="text-white">{data.bootstrap.onboardingCompleted ? 'yes' : 'no'}</strong>
    </p>
  </SurfaceCard>
</div>

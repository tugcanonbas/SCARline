<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader
  eyebrow="Mission Control"
  title="Dashboard"
  description="Health, study state, and recent session activity for the current lab runtime."
>
  {#snippet actions()}
    <div class="flex gap-3">
      <a class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" href="/user-studies/new">New Study</a>
      <a class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" href="/startup">Startup View</a>
    </div>
  {/snippet}
</PageHeader>

<div class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
  <div class="grid gap-4 md:grid-cols-2">
    <SurfaceCard title="Active Studies"><p class="text-3xl font-semibold">{data.dashboard.activeStudies}</p></SurfaceCard>
    <SurfaceCard title="Total Sessions"><p class="text-3xl font-semibold">{data.dashboard.totalSessions}</p></SurfaceCard>
    <SurfaceCard title="Participants"><p class="text-3xl font-semibold">{data.dashboard.totalParticipants}</p></SurfaceCard>
    <SurfaceCard title="Captured Events"><p class="text-3xl font-semibold">{data.dashboard.totalEvents}</p></SurfaceCard>
  </div>

  <SurfaceCard title="Component Health">
    <div class="space-y-3">
      {#each data.dashboard.componentHealth as component}
        <div class="flex items-center justify-between rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
          <span>{component.componentName ?? component.componentId}</span>
          <span class="text-[--color-accent]">{component.status}</span>
        </div>
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Recent Sessions">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.dashboard.recentSessions, null, 2)}</pre>
  </SurfaceCard>
</div>

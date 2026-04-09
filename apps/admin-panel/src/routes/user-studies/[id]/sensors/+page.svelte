<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title="Sensor Configuration" description="Milestone-1 sensor scope covers Logitech G29 steering and best-effort USB camera capture." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/sensors`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Drivers in Scope">
    <div class="space-y-3 text-sm text-slate-300">
      {#each data.drivers as driver}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
          <p class="font-semibold text-white">{driver.displayName}</p>
          <p>{driver.sensorType}</p>
        </div>
      {/each}
    </div>
    <form class="mt-4" method="POST">
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Apply Milestone-1 Sensor Set</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Current Sensor Config">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.config, null, 2)}</pre>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const configuredSensors = $derived(data.config?.sensors ?? []);
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
    <div class="space-y-3">
      {#each configuredSensors as sensor}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{sensor.driver ?? sensor.driverId}</p>
              <p class="mt-1 text-sm text-slate-400">{sensor.type ?? sensor.sensorType} · {sensor.sample_rate ?? sensor.sampleRate ?? 0}Hz</p>
            </div>
            <StatusBadge status="ready" label="Configured" />
          </div>
          <p class="mt-3 text-xs text-slate-500">Metadata: {Object.keys(sensor.metadata ?? {}).join(', ') || 'none'}</p>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No sensors are configured for this study yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const configuredSensors = $derived(data.config?.sensors ?? []);
  const driverCount = $derived(data.drivers.length);
  const highRateSensors = $derived(configuredSensors.filter((sensor: Record<string, unknown>) => Number(sensor.sample_rate ?? sensor.sampleRate ?? 0) >= 20).length);

  function sensorForDriver(driverId: string) {
    return configuredSensors.find((sensor: Record<string, unknown>) => (sensor.driver ?? sensor.driverId) === driverId) as Record<string, unknown> | undefined;
  }

  function metadataText(sensor: Record<string, unknown> | undefined) {
    return JSON.stringify(sensor?.metadata ?? {}, null, 2);
  }
</script>

<PageHeader eyebrow="Study" title="Sensor Configuration" description="Milestone-1 sensor scope covers Logitech G29 steering and best-effort USB camera capture." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/sensors`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Driver Catalogue</p>
    <p class="metric-card__value">{driverCount}</p>
    <p class="metric-card__hint">Drivers offered by the current host</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Configured Sensors</p>
    <p class="metric-card__value">{configuredSensors.length}</p>
    <p class="metric-card__hint">Persisted in the study sensor config</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">High Rate Streams</p>
    <p class="metric-card__value">{highRateSensors}</p>
    <p class="metric-card__hint">20Hz or greater acquisition targets</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Degradation</p>
    <p class="metric-card__value">Safe</p>
    <p class="metric-card__hint">Absent optional hardware should not block mock runs</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Driver Configuration" subtitle="Enable study sensors, sampling rates, metadata, and required/best-effort behavior.">
    {#if data.canManage}
      <form class="space-y-3 text-sm text-slate-300" method="POST" action="?/save">
        {#each data.drivers as driver}
          {@const existing = sensorForDriver(driver.driverId)}
          <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
            <label class="flex items-start gap-3">
              <input checked={Boolean(existing)} class="mt-1" name="driverId" type="checkbox" value={driver.driverId} />
              <span>
                <span class="block font-semibold text-white">{driver.displayName}</span>
                <span>{driver.sensorType}</span>
              </span>
            </label>
            <input name={`${driver.driverId}:sensorType`} type="hidden" value={driver.sensorType} />
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5">
                <span>Sample Rate (Hz)</span>
                <input
                  class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2"
                  min="1"
                  name={`${driver.driverId}:sampleRate`}
                  type="number"
                  value={existing?.sample_rate ?? existing?.sampleRate ?? (driver.driverId === 'logitech_g29' ? 100 : 30)}
                />
              </label>
              <label class="flex items-center gap-2">
                <input checked={Boolean(existing?.required)} name={`${driver.driverId}:required`} type="checkbox" />
                <span>Required for session start</span>
              </label>
              <label class="grid gap-1.5 md:col-span-2">
                <span>Metadata JSON</span>
                <textarea class="min-h-24 rounded-2xl border border-[--color-line] bg-transparent px-3 py-2 font-mono text-xs" name={`${driver.driverId}:metadata`}>{metadataText(existing)}</textarea>
              </label>
            </div>
          </div>
        {/each}
        <div class="flex flex-wrap gap-3">
          <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Sensor Configuration</button>
          <button class="rounded-2xl border border-[--color-line] px-5 py-3 text-sm font-semibold" formaction="?/preset" type="submit">Apply Default Sensor Set</button>
        </div>
      </form>
    {:else}
      <div class="space-y-3 text-sm text-slate-300">
        {#each data.drivers as driver}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
          <p class="font-semibold text-white">{driver.displayName}</p>
          <p>{driver.sensorType}</p>
        </div>
        {/each}
      </div>
    {/if}
  </SurfaceCard>

  <SurfaceCard title="Current Sensor Config" subtitle="Operator-facing readiness view for the sensors persisted on this study.">
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
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <div class="technical-panel">
              <p class="technical-label">Rate</p>
              <p class="technical-value">{sensor.sample_rate ?? sensor.sampleRate ?? 0}Hz</p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Mode</p>
              <p class="technical-value">{sensor.required ? 'Required' : 'Best effort'}</p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Metadata</p>
              <p class="technical-value">{Object.keys(sensor.metadata ?? {}).join(', ') || 'none'}</p>
            </div>
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No sensors are configured for this study yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
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
  <MetricCard label="Driver Catalogue" value={driverCount} hint="Drivers offered by the current host" accent />
  <MetricCard label="Configured Sensors" value={configuredSensors.length} hint="Persisted in the study sensor config" />
  <MetricCard label="High Rate Streams" value={highRateSensors} hint="20Hz or greater acquisition targets" />
  <MetricCard label="Degradation" value="Safe" hint="Absent optional hardware should not block mock runs" />
</div>

<div class="section-grid section-grid--sidebar">
  <SurfaceCard title="Driver Configuration" subtitle="Enable study sensors, sampling rates, metadata, and required/best-effort behavior.">
    {#if data.canManage}
      <form class="list-stack" method="POST" action="?/save">
        {#each data.drivers as driver}
          {@const existing = sensorForDriver(driver.driverId)}
          <div class="entity-card entity-card--tight">
            <label class="flex items-start gap-3">
              <input checked={Boolean(existing)} class="mt-1" name="driverId" type="checkbox" value={driver.driverId} />
              <span>
                <span class="block font-semibold">{driver.displayName}</span>
                <span>{driver.sensorType}</span>
              </span>
            </label>
            <input name={`${driver.driverId}:sensorType`} type="hidden" value={driver.sensorType} />
            <div class="form-grid-2">
              <label class="form-field">
                <span>Sample Rate (Hz)</span>
                <input
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
              <label class="form-field md:col-span-2">
                <span>Metadata JSON</span>
                <textarea class="min-h-24 font-mono text-xs" name={`${driver.driverId}:metadata`}>{metadataText(existing)}</textarea>
              </label>
            </div>
          </div>
        {/each}
        <div class="form-actions">
          <button class="button-primary" formaction="?/save" type="submit">Save Sensor Configuration</button>
          <button class="button-secondary" formaction="?/preset" type="submit">Apply Default Sensor Set</button>
        </div>
      </form>
    {:else}
      <div class="list-stack">
        {#each data.drivers as driver}
        <div class="entity-card entity-card--tight">
          <p class="entity-card__title">{driver.displayName}</p>
          <p>{driver.sensorType}</p>
        </div>
        {/each}
      </div>
    {/if}
  </SurfaceCard>

  <SurfaceCard title="Current Sensor Config" subtitle="Operator-facing readiness view for the sensors persisted on this study.">
    <div class="list-stack">
      {#each configuredSensors as sensor}
        <div class="entity-card">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">{sensor.driver ?? sensor.driverId}</p>
              <p class="entity-card__meta">{sensor.type ?? sensor.sensorType} · {sensor.sample_rate ?? sensor.sampleRate ?? 0}Hz</p>
            </div>
            <StatusBadge status="ready" label="Configured" />
          </div>
          <div class="detail-grid-3">
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
        <EmptyState message="No sensors are configured for this study yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

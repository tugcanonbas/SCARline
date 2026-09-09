<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import StudyLifecycleControls from "$lib/components/admin/studies/StudyLifecycleControls.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { appPath } from "$lib/paths";
  import { studySectionHref } from "$lib/studySections";
  import { RefreshCw } from "lucide-svelte";
  import { STUDY_DESIGN_ACCESS_REQUIRED } from "$lib/permissions";

  let { data } = $props();
  const configuredSensors = $derived(data.config?.sensors ?? []);
  const driverCount = $derived(data.drivers.length);
  const highRateSensors = $derived(
    configuredSensors.reduce((count: number, sensor: Record<string, unknown>) =>
      count + Object.values(sensor.channelRates ?? { default: sensor.sample_rate ?? sensor.sampleRate ?? 0 }).filter((rate) => Number(rate) >= 20).length, 0),
  );

  function sensorForDriver(driverId: string) {
    return configuredSensors.find(
      (sensor: Record<string, unknown>) =>
        (sensor.driver ?? sensor.driverId) === driverId,
    ) as Record<string, unknown> | undefined;
  }

  function metadataText(sensor: Record<string, unknown> | undefined) {
    return JSON.stringify(sensor?.metadata ?? {}, null, 2);
  }
</script>

<PageHeader
  eyebrow="Study"
  title={data.study?.name ?? "Unknown Study"}
  description={data.study?.description ?? "No description"}
>
  {#snippet actions()}
    <StudyLifecycleControls study={data.study} readiness={data.readiness} canManage={data.canManage} />
  {/snippet}
</PageHeader>
<StudyTabs
  studyId={data.studyId}
  current={`/user-studies/${data.studyId}/sensors`}
/>

<div class="metric-grid">
  <MetricCard
    label="Driver Catalogue"
    value={driverCount}
    hint="Drivers offered by the current host"
  />
  <MetricCard
    label="Configured Sensors"
    value={configuredSensors.length}
    hint="Persisted in the study sensor config"
  />
  <MetricCard
    label="High Rate Streams"
    value={highRateSensors}
    hint="20Hz or greater acquisition targets"
  />
  <MetricCard
    label="If Hardware Missing"
    value="Study Continues"
    hint="Optional sensors that aren't connected are skipped — only sensors marked Required must be present to start"
  />
</div>

<div class="section-grid section-grid--sidebar mt-4">
  <SurfaceCard
    title="Driver Configuration"
    subtitle="Configure physical lab hardware discovered from the sensor driver directory."
  >
    <form class="form-actions mb-4" method="POST" action="?/refresh">
        <button class="button-secondary" type="submit" disabled={!data.canManage} title={!data.canManage ? STUDY_DESIGN_ACCESS_REQUIRED : undefined}>
          <RefreshCw size={18} strokeWidth={1.5} />
          Refresh Sensor Drivers
        </button>
        <span class="form-field__hint">Reads new and updated manifests without rebuilding the platform.</span>
    </form>
    <p class="form-field__hint mb-4">
      Looking for in-simulator sensors instead (cameras, LiDAR, GPS)? Those
      are on the
      <a href={appPath(studySectionHref(data.studyId, "simulator"))}
        >Simulator Setup tab</a
      >.
    </p>
    <form class="list-stack" method="POST" action="?/save">
      <fieldset class="contents" disabled={!data.canManage} title={!data.canManage ? STUDY_DESIGN_ACCESS_REQUIRED : undefined}>
        {#each data.drivers as driver}
          {@const existing = sensorForDriver(driver.driverId)}
          <div class="entity-card entity-card--tight">
            <label class="flex items-start gap-3">
              <input
                checked={Boolean(existing)}
                class="mt-1"
                name="driverId"
                type="checkbox"
                value={driver.driverId}
              />
              <span>
                <span class="block font-semibold">{driver.displayName}</span>
                <span>{driver.sensorType}</span>
              </span>
            </label>
            <input
              name={`${driver.driverId}:sensorType`}
              type="hidden"
              value={driver.sensorType}
            />
            <input
              name={`${driver.driverId}:driverKey`}
              type="hidden"
              value={driver.driverKey}
            />
            <p class="form-field__hint">
              {driver.channels.map((channel: Record<string, unknown>) => channel.name ?? channel.key).join(" · ")}
            </p>
            <div class="form-grid-2">
              <div class="form-field">
                <span>Channel Sample Rates</span>
                <div class="list-stack">
                  {#each driver.channels as channel}
                    <input name={`${driver.driverId}:channelId`} type="hidden" value={channel.id} />
                    <label class="form-field">
                      <span class="form-field__hint">{channel.name ?? channel.key} (Hz)</span>
                      <input
                        min="0.1"
                        step="any"
                        name={`${driver.driverId}:${channel.id}:sampleRate`}
                        type="number"
                        value={(existing?.channelRates as Record<string, unknown> | undefined)?.[channel.id] ?? channel.metadata?.sampleRate ?? driver.defaultSampleRate}
                      />
                    </label>
                  {/each}
                </div>
              </div>
              <label class="flex items-center gap-2">
                <input
                  checked={Boolean(existing?.required)}
                  name={`${driver.driverId}:required`}
                  type="checkbox"
                />
                <span>Required for session start</span>
              </label>
              {#if driver.supportsRecording}
                <label class="flex items-center gap-2">
                  <input
                    checked={Boolean(existing?.recording)}
                    name={`${driver.driverId}:recording`}
                    type="checkbox"
                  />
                  <span>Record camera locally during the session</span>
                </label>
              {/if}
              <details class="md:col-span-2">
                <summary>Advanced: raw metadata (JSON)</summary>
                <label class="form-field mt-2">
                  <span class="form-field__hint"
                    >Extra settings specific to this sensor driver. Most
                    setups don't need to touch this.</span
                  >
                  <textarea
                    class="min-h-24 font-mono text-xs"
                    name={`${driver.driverId}:metadata`}
                    >{metadataText(existing)}</textarea
                  >
                </label>
              </details>
            </div>
          </div>
        {/each}
        <div class="form-actions">
          <button class="button-primary" formaction="?/save" type="submit" title={!data.canManage ? STUDY_DESIGN_ACCESS_REQUIRED : undefined}
            >Save Sensor Configuration</button
          >
          <button class="button-secondary" formaction="?/preset" type="submit" title={!data.canManage ? STUDY_DESIGN_ACCESS_REQUIRED : undefined}
            >Apply Default Sensor Set</button
          >
        </div>
      </fieldset>
    </form>
  </SurfaceCard>

  <SurfaceCard
    title="Current Sensor Config"
    subtitle="Operator-facing readiness view for the sensors persisted on this study."
  >
    <div class="list-stack">
      {#each configuredSensors as sensor}
        <div class="entity-card">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">
                {sensor.driver ?? sensor.driverId}
              </p>
              <p class="entity-card__meta">
                {sensor.type ?? sensor.sensorType} · {Object.keys(sensor.channelRates ?? {}).length || 1} channel(s)
              </p>
            </div>
            <StatusBadge status="ready" label="Configured" />
          </div>
          <div class="detail-grid-3">
            <div class="technical-panel">
              <p class="technical-label">Rate</p>
              <p class="technical-value">
                {Object.values(sensor.channelRates ?? { default: sensor.sample_rate ?? sensor.sampleRate ?? 0 }).map((rate) => `${rate}Hz`).join(" · ")}
              </p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Mode</p>
              <p class="technical-value">
                {sensor.required ? "Required" : "Optional (skipped if missing)"}
              </p>
            </div>
            <div class="technical-panel">
              <p class="technical-label">Metadata</p>
              <p class="technical-value">
                {Object.keys(sensor.metadata ?? {}).join(", ") || "none"}
              </p>
            </div>
          </div>
        </div>
      {:else}
        <EmptyState message="No sensors are configured for this study yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

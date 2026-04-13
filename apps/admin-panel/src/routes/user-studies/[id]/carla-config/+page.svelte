<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const configItems = $derived([
    { label: 'Map', value: data.config?.map ?? 'Not configured' },
    { label: 'Weather', value: data.config?.weatherPreset ?? data.config?.weather_preset ?? 'Default' },
    { label: 'Ego Vehicle', value: data.config?.egoVehicleBlueprint ?? data.config?.ego_vehicle_blueprint ?? 'Not configured' },
    { label: 'Simulation Mode', value: data.config?.simulationMode ?? data.config?.simulation_mode ?? 'synchronous' },
    { label: 'Fixed Delta', value: data.config?.fixedDeltaSeconds ?? data.config?.fixed_delta_seconds ?? 0.05 },
    { label: 'Traffic', value: data.config?.trafficConfig ?? data.config?.traffic_config ?? {} }
  ]);
  const configuredSensors = $derived(data.config?.sensors ?? []);
</script>

<PageHeader eyebrow="Study" title="CARLA Configuration" description="Baseline simulator settings used for session start commands and condition overrides." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/carla-config`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Simulator Defaults">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Map</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="map">
          {#each data.maps as map}
            <option value={map} selected={data.config?.map === map}>{map}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Weather Preset</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="weatherPreset">
          <option value="">None</option>
          {#each data.weather as preset}
            <option value={preset} selected={data.config?.weather_preset === preset}>{preset}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Ego Vehicle</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="vehicle">
          {#each data.vehicles as vehicle}
            <option value={vehicle} selected={data.config?.ego_vehicle_blueprint === vehicle}>{vehicle}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>NPC Vehicles</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="npcVehicleCount" type="number" value="15" />
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Configuration</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Current Config">
    <KeyValueGrid items={configItems} />
    <div class="mt-4 space-y-3">
      <p class="text-sm font-semibold text-white">Attached Sensors</p>
      {#each configuredSensors as sensor}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
          <p class="font-semibold text-white">{sensor.id ?? sensor.type}</p>
          <p class="text-slate-400">{sensor.type} · transform x={sensor.transform?.x ?? 0}, y={sensor.transform?.y ?? 0}, z={sensor.transform?.z ?? 0}</p>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No simulator sensors are configured.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

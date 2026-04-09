<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
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
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.config, null, 2)}</pre>
  </SurfaceCard>
</div>

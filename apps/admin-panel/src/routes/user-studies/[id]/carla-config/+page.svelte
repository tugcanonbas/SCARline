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
  const trafficConfig = $derived((data.config?.trafficConfig ?? data.config?.traffic_config ?? {}) as Record<string, unknown>);
  const weatherCustom = $derived((data.config?.weatherCustom ?? data.config?.weather_custom ?? {}) as Record<string, unknown>);
  const pedestrianConfig = $derived((data.config?.pedestrianConfig ?? data.config?.pedestrian_config ?? {}) as Record<string, unknown>);
  const sunConfig = $derived((data.config?.sunConfig ?? data.config?.sun_config ?? {}) as Record<string, unknown>);
  const spectatorConfig = $derived((data.config?.spectatorConfig ?? data.config?.spectator_config ?? {}) as Record<string, unknown>);
  const recordingConfig = $derived((data.config?.recordingConfig ?? data.config?.recording_config ?? {}) as Record<string, unknown>);

  function sensorConfigured(type: string) {
    if (!configuredSensors.length) {
      return ['sensor.camera.rgb', 'sensor.other.collision', 'sensor.other.lane_invasion'].includes(type);
    }

    return configuredSensors.some((sensor: Record<string, unknown>) => sensor.type === type);
  }

  function sensorAttribute(type: string, key: string, fallback: string | number) {
    const sensor = configuredSensors.find((entry: Record<string, unknown>) => entry.type === type) as Record<string, unknown> | undefined;
    const attributes = (sensor?.attributes ?? {}) as Record<string, unknown>;
    return attributes[key] ?? fallback;
  }
</script>

<PageHeader eyebrow="Study" title="CARLA Configuration" description="Baseline simulator settings used for session start commands and condition overrides." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/carla-config`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Map</p>
    <p class="metric-card__value">{data.config?.map ?? 'Unset'}</p>
    <p class="metric-card__hint">World loaded before session start</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Weather</p>
    <p class="metric-card__value">{data.config?.weatherPreset ?? data.config?.weather_preset ?? 'Default'}</p>
    <p class="metric-card__hint">Baseline before condition overrides</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Sensors</p>
    <p class="metric-card__value">{configuredSensors.length}</p>
    <p class="metric-card__hint">Simulator-attached devices</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">NPC Vehicles</p>
    <p class="metric-card__value">{trafficConfig.npcVehicleCount ?? trafficConfig.npc_vehicle_count ?? 15}</p>
    <p class="metric-card__hint">Traffic density baseline</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  {#if data.canManage}
    <SurfaceCard title="Simulator Defaults" subtitle="These values are persisted as the study-level CARLA baseline.">
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
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" min="0" name="npcVehicleCount" type="number" value={trafficConfig.npcVehicleCount ?? trafficConfig.npc_vehicle_count ?? 15} />
        </label>
        <div class="grid gap-3 md:grid-cols-3">
          <label class="grid gap-2 text-sm">
            <span>Pedestrians</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" min="0" name="pedestrianCount" type="number" value={pedestrianConfig.pedestrianCount ?? pedestrianConfig.pedestrian_count ?? 0} />
          </label>
          <label class="grid gap-2 text-sm">
            <span>Traffic Speed Difference</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="trafficSpeedDifference" type="number" value={trafficConfig.speedDifference ?? trafficConfig.speed_difference ?? 0} />
          </label>
          <label class="grid gap-2 text-sm">
            <span>Sun Altitude Angle</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="sunAltitudeAngle" type="number" value={sunConfig.sunAltitudeAngle ?? sunConfig.sun_altitude_angle ?? 45} />
          </label>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <label class="grid gap-2 text-sm">
            <span>Cloudiness</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" max="100" min="0" name="cloudiness" type="number" value={weatherCustom.cloudiness ?? 0} />
          </label>
          <label class="grid gap-2 text-sm">
            <span>Precipitation</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" max="100" min="0" name="precipitation" type="number" value={weatherCustom.precipitation ?? 0} />
          </label>
          <label class="grid gap-2 text-sm">
            <span>Wind Intensity</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" max="100" min="0" name="windIntensity" type="number" value={weatherCustom.windIntensity ?? weatherCustom.wind_intensity ?? 0} />
          </label>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-2 text-sm">
            <span>Simulation Mode</span>
            <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="simulationMode">
              <option value="synchronous" selected={(data.config?.simulationMode ?? data.config?.simulation_mode ?? 'synchronous') === 'synchronous'}>synchronous</option>
              <option value="asynchronous" selected={(data.config?.simulationMode ?? data.config?.simulation_mode) === 'asynchronous'}>asynchronous</option>
            </select>
          </label>
          <label class="grid gap-2 text-sm">
            <span>Fixed Delta Seconds</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="fixedDeltaSeconds" step="0.01" type="number" value={data.config?.fixedDeltaSeconds ?? data.config?.fixed_delta_seconds ?? 0.05} />
          </label>
        </div>
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <p class="text-sm font-semibold text-white">Simulator Sensors</p>
          <div class="mt-3 grid gap-2 md:grid-cols-2">
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.camera.rgb')} name="sensorRgb" type="checkbox" /> RGB camera</label>
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.lidar.ray_cast')} name="sensorLidar" type="checkbox" /> LiDAR</label>
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.other.gnss')} name="sensorGnss" type="checkbox" /> GNSS</label>
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.other.imu')} name="sensorImu" type="checkbox" /> IMU</label>
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.other.collision')} name="sensorCollision" type="checkbox" /> Collision</label>
            <label class="flex items-center gap-2 text-sm"><input checked={sensorConfigured('sensor.other.lane_invasion')} name="sensorLane" type="checkbox" /> Lane invasion</label>
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <label class="grid gap-1.5 text-sm"><span>Camera Width</span><input class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2" name="cameraWidth" type="number" value={sensorAttribute('sensor.camera.rgb', 'image_size_x', 1280)} /></label>
            <label class="grid gap-1.5 text-sm"><span>Camera Height</span><input class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2" name="cameraHeight" type="number" value={sensorAttribute('sensor.camera.rgb', 'image_size_y', 720)} /></label>
            <label class="grid gap-1.5 text-sm"><span>Camera FOV</span><input class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2" name="cameraFov" type="number" value={sensorAttribute('sensor.camera.rgb', 'fov', 90)} /></label>
            <label class="grid gap-1.5 text-sm"><span>LiDAR Range</span><input class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2" name="lidarRange" type="number" value={sensorAttribute('sensor.lidar.ray_cast', 'range', 80)} /></label>
            <label class="grid gap-1.5 text-sm"><span>LiDAR Channels</span><input class="rounded-2xl border border-[--color-line] bg-transparent px-3 py-2" name="lidarChannels" type="number" value={sensorAttribute('sensor.lidar.ray_cast', 'channels', 32)} /></label>
          </div>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex items-center gap-2 text-sm"><input checked={Boolean(spectatorConfig.enabled ?? true)} name="spectatorEnabled" type="checkbox" /> Enable spectator camera</label>
          <label class="flex items-center gap-2 text-sm"><input checked={Boolean(recordingConfig.enabled ?? false)} name="recordingEnabled" type="checkbox" /> Enable CARLA recording</label>
          <input name="spectatorX" type="hidden" value={spectatorConfig.x ?? -6} />
          <input name="spectatorY" type="hidden" value={spectatorConfig.y ?? 0} />
          <input name="spectatorZ" type="hidden" value={spectatorConfig.z ?? 4} />
          <input name="spectatorPitch" type="hidden" value={spectatorConfig.pitch ?? -15} />
          <input name="spectatorYaw" type="hidden" value={spectatorConfig.yaw ?? 0} />
          <label class="grid gap-2 text-sm md:col-span-2">
            <span>Recording Directory</span>
            <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="recordingDirectory" value={recordingConfig.directory ?? ''} />
          </label>
        </div>
        <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Configuration</button>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard title="Current Config" subtitle="Read-only command preview used when a session is started.">
    <KeyValueGrid items={configItems} />
    <div class="mt-4 grid gap-3 md:grid-cols-3">
      <div class="technical-panel">
        <p class="technical-label">Mode</p>
        <p class="technical-value">{data.config?.simulationMode ?? data.config?.simulation_mode ?? 'synchronous'}</p>
      </div>
      <div class="technical-panel">
        <p class="technical-label">Tick Rate</p>
        <p class="technical-value">{data.config?.fixedDeltaSeconds ?? data.config?.fixed_delta_seconds ?? 0.05}s fixed delta</p>
      </div>
      <div class="technical-panel">
        <p class="technical-label">Condition Layer</p>
        <p class="technical-value">Applied by session setup when a condition is selected</p>
      </div>
    </div>
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

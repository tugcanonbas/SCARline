<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { appPath } from "$lib/paths";
  import { Database } from "lucide-svelte";

  let { data } = $props();
  const configItems = $derived([
    { label: "Map", value: data.config?.map ?? "Not configured" },
    {
      label: "Weather",
      value:
        data.config?.weatherPreset ?? data.config?.weather_preset ?? "Default",
    },
    {
      label: "Ego Vehicle",
      value:
        data.config?.egoVehicleBlueprint ??
        data.config?.ego_vehicle_blueprint ??
        "Not configured",
    },
    {
      label: "Simulation Mode",
      value:
        data.config?.simulationMode ??
        data.config?.simulation_mode ??
        "synchronous",
    },
    {
      label: "Tick Rate",
      value:
        (data.config?.fixedDeltaSeconds ??
          data.config?.fixed_delta_seconds ??
          0.05) + "s (fixed delta)",
    },
    {
      label: "Traffic",
      value: data.config?.trafficConfig ?? data.config?.traffic_config ?? {},
    },
  ]);
  const configuredSensors = $derived(data.config?.sensors ?? []);
  const trafficConfig = $derived(
    (data.config?.trafficConfig ?? data.config?.traffic_config ?? {}) as Record<
      string,
      unknown
    >,
  );
  const weatherCustom = $derived(
    (data.config?.weatherCustom ?? data.config?.weather_custom ?? {}) as Record<
      string,
      unknown
    >,
  );
  const pedestrianConfig = $derived(
    (data.config?.pedestrianConfig ??
      data.config?.pedestrian_config ??
      {}) as Record<string, unknown>,
  );
  const sunConfig = $derived(
    (data.config?.sunConfig ?? data.config?.sun_config ?? {}) as Record<
      string,
      unknown
    >,
  );
  const spectatorConfig = $derived(
    (data.config?.spectatorConfig ??
      data.config?.spectator_config ??
      {}) as Record<string, unknown>,
  );
  const recordingConfig = $derived(
    (data.config?.recordingConfig ??
      data.config?.recording_config ??
      {}) as Record<string, unknown>,
  );

  function sensorConfigured(type: string) {
    if (!configuredSensors.length) {
      return [
        "sensor.camera.rgb",
        "sensor.other.collision",
        "sensor.other.lane_invasion",
      ].includes(type);
    }

    return configuredSensors.some(
      (sensor: Record<string, unknown>) => sensor.type === type,
    );
  }

  function sensorAttribute(
    type: string,
    key: string,
    fallback: string | number,
  ) {
    const sensor = configuredSensors.find(
      (entry: Record<string, unknown>) => entry.type === type,
    ) as Record<string, unknown> | undefined;
    const attributes = (sensor?.attributes ?? {}) as Record<string, unknown>;
    return attributes[key] ?? fallback;
  }
</script>

<PageHeader
  eyebrow="Study"
  title={data.study?.name ?? "Unknown Study"}
  description={data.study?.description ?? "No description"}
>
  {#snippet actions()}
    <div class="action-strip">
      <a
        class="button-primary"
        href={appPath(`/user-studies/${data.study.id}/sessions`)}
      >
        <Database size={24} strokeWidth={1.5} />
        New Session
      </a>
    </div>
  {/snippet}
</PageHeader>
<StudyTabs
  studyId={data.studyId}
  current={`/user-studies/${data.studyId}/carla-config`}
/>

<div class="metric-grid">
  <MetricCard
    label="Map"
    value={data.config?.map ?? "Unset"}
    hint="World loaded before session start"
  />
  <MetricCard
    label="Weather"
    value={data.config?.weatherPreset ??
      data.config?.weather_preset ??
      "Default"}
    hint="Baseline before condition overrides"
  />
  <MetricCard
    label="Sensors"
    value={configuredSensors.length}
    hint="Simulator-attached devices"
  />
  <MetricCard
    label="NPC Vehicles"
    value={Number(
      trafficConfig.npcVehicleCount ?? trafficConfig.npc_vehicle_count ?? 15,
    )}
    hint="Traffic density baseline"
  />
</div>

<div class="section-grid section-grid--balanced mt-4">
  {#if data.canManage}
    <SurfaceCard
      title="Simulator Defaults"
      subtitle="These values are persisted as the study-level CARLA baseline."
    >
      <form class="form-stack" method="POST">
        <label class="form-field">
          <span>Map</span>
          <select name="map">
            {#each data.maps as map}
              <option value={map} selected={data.config?.map === map}
                >{map}</option
              >
            {/each}
          </select>
        </label>
        <label class="form-field">
          <span>Weather Preset</span>
          <select name="weatherPreset">
            <option value="">None</option>
            {#each data.weather as preset}
              <option
                value={preset}
                selected={data.config?.weather_preset === preset}
                >{preset}</option
              >
            {/each}
          </select>
        </label>
        <label class="form-field">
          <span>Ego Vehicle</span>
          <select name="vehicle">
            {#each data.vehicles as vehicle}
              <option
                value={vehicle}
                selected={data.config?.ego_vehicle_blueprint === vehicle}
                >{vehicle}</option
              >
            {/each}
          </select>
        </label>
        <label class="form-field">
          <span>NPC Vehicles</span>
          <input
            min="0"
            name="npcVehicleCount"
            type="number"
            value={trafficConfig.npcVehicleCount ??
              trafficConfig.npc_vehicle_count ??
              15}
          />
        </label>
        <div class="form-grid-3">
          <label class="form-field">
            <span>Pedestrians</span>
            <input
              min="0"
              name="pedestrianCount"
              type="number"
              value={pedestrianConfig.pedestrianCount ??
                pedestrianConfig.pedestrian_count ??
                0}
            />
          </label>
          <label class="form-field">
            <span>Traffic Speed Difference</span>
            <input
              name="trafficSpeedDifference"
              type="number"
              value={trafficConfig.speedDifference ??
                trafficConfig.speed_difference ??
                0}
            />
          </label>
          <label class="form-field">
            <span>Sun Altitude Angle</span>
            <input
              name="sunAltitudeAngle"
              type="number"
              value={sunConfig.sunAltitudeAngle ??
                sunConfig.sun_altitude_angle ??
                45}
            />
          </label>
        </div>
        <div class="form-grid-3">
          <label class="form-field">
            <span>Cloudiness</span>
            <input
              max="100"
              min="0"
              name="cloudiness"
              type="number"
              value={weatherCustom.cloudiness ?? 0}
            />
          </label>
          <label class="form-field">
            <span>Precipitation</span>
            <input
              max="100"
              min="0"
              name="precipitation"
              type="number"
              value={weatherCustom.precipitation ?? 0}
            />
          </label>
          <label class="form-field">
            <span>Wind Intensity</span>
            <input
              max="100"
              min="0"
              name="windIntensity"
              type="number"
              value={weatherCustom.windIntensity ??
                weatherCustom.wind_intensity ??
                0}
            />
          </label>
        </div>
        <div class="form-grid-2">
          <label class="form-field">
            <span>Simulation Mode</span>
            <select name="simulationMode">
              <option
                value="synchronous"
                selected={(data.config?.simulationMode ??
                  data.config?.simulation_mode ??
                  "synchronous") === "synchronous"}>synchronous</option
              >
              <option
                value="asynchronous"
                selected={(data.config?.simulationMode ??
                  data.config?.simulation_mode) === "asynchronous"}
                >asynchronous</option
              >
            </select>
          </label>
          <label class="form-field">
            <span>Fixed Delta Seconds</span>
            <input
              name="fixedDeltaSeconds"
              step="0.01"
              type="number"
              value={data.config?.fixedDeltaSeconds ??
                data.config?.fixed_delta_seconds ??
                0.05}
            />
          </label>
        </div>
        <div class="detail-panel">
          <p class="entity-card__title">Simulator Sensors</p>
          <div class="choice-grid mt-3">
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.camera.rgb")}
                name="sensorRgb"
                type="checkbox"
              /> RGB camera</label
            >
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.lidar.ray_cast")}
                name="sensorLidar"
                type="checkbox"
              /> LiDAR</label
            >
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.other.gnss")}
                name="sensorGnss"
                type="checkbox"
              /> GNSS</label
            >
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.other.imu")}
                name="sensorImu"
                type="checkbox"
              /> IMU</label
            >
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.other.collision")}
                name="sensorCollision"
                type="checkbox"
              /> Collision</label
            >
            <label class="flex items-center gap-2 text-sm"
              ><input
                checked={sensorConfigured("sensor.other.lane_invasion")}
                name="sensorLane"
                type="checkbox"
              /> Lane invasion</label
            >
          </div>
          <div class="form-grid-3 mt-3">
            <label class="form-field form-field--compact"
              ><span>Camera Width</span><input
                name="cameraWidth"
                type="number"
                value={sensorAttribute(
                  "sensor.camera.rgb",
                  "image_size_x",
                  1280,
                )}
              /></label
            >
            <label class="form-field form-field--compact"
              ><span>Camera Height</span><input
                name="cameraHeight"
                type="number"
                value={sensorAttribute(
                  "sensor.camera.rgb",
                  "image_size_y",
                  720,
                )}
              /></label
            >
            <label class="form-field form-field--compact"
              ><span>Camera FOV</span><input
                name="cameraFov"
                type="number"
                value={sensorAttribute("sensor.camera.rgb", "fov", 90)}
              /></label
            >
            <label class="form-field form-field--compact"
              ><span>LiDAR Range</span><input
                name="lidarRange"
                type="number"
                value={sensorAttribute("sensor.lidar.ray_cast", "range", 80)}
              /></label
            >
            <label class="form-field form-field--compact"
              ><span>LiDAR Channels</span><input
                name="lidarChannels"
                type="number"
                value={sensorAttribute("sensor.lidar.ray_cast", "channels", 32)}
              /></label
            >
          </div>
        </div>
        <div class="form-grid-2">
          <label class="flex items-center gap-2 text-sm"
            ><input
              checked={Boolean(spectatorConfig.enabled ?? true)}
              name="spectatorEnabled"
              type="checkbox"
            /> Enable spectator camera</label
          >
          <label class="flex items-center gap-2 text-sm"
            ><input
              checked={Boolean(recordingConfig.enabled ?? false)}
              name="recordingEnabled"
              type="checkbox"
            /> Enable CARLA recording</label
          >
          <input
            name="spectatorX"
            type="hidden"
            value={spectatorConfig.x ?? -6}
          />
          <input
            name="spectatorY"
            type="hidden"
            value={spectatorConfig.y ?? 0}
          />
          <input
            name="spectatorZ"
            type="hidden"
            value={spectatorConfig.z ?? 4}
          />
          <input
            name="spectatorPitch"
            type="hidden"
            value={spectatorConfig.pitch ?? -15}
          />
          <input
            name="spectatorYaw"
            type="hidden"
            value={spectatorConfig.yaw ?? 0}
          />
          <label class="form-field md:col-span-2">
            <span>Recording Directory</span>
            <input
              name="recordingDirectory"
              value={recordingConfig.directory ?? ""}
            />
          </label>
        </div>
        <button class="button-primary" type="submit">Save Configuration</button>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard title="Current Setup">
    <KeyValueGrid items={configItems} />
    <div class="mt-4 grid gap-3 md:grid-cols-3">
      <div class="technical-panel">
        <p class="technical-label">Condition Layer</p>
        <p class="technical-value">
          Applied by session setup when a condition is selected
        </p>
      </div>
    </div>
    <div class="mt-4 space-y-3">
      <p class="entity-card__title">Attached Sensors</p>
      {#each configuredSensors as sensor}
        <div class="entity-card entity-card--tight">
          <p class="entity-card__title">{sensor.id ?? sensor.type}</p>
          <p class="entity-card__meta">
            {sensor.type} · transform x={sensor.transform?.x ?? 0}, y={sensor
              .transform?.y ?? 0}, z={sensor.transform?.z ?? 0}
          </p>
        </div>
      {:else}
        <EmptyState message="No simulator sensors are configured." />
      {/each}
    </div>
  </SurfaceCard>
</div>

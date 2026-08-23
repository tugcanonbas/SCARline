<script lang="ts">
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";

  let {
    vehicleState,
    speedHistory = [],
    throttleHistory = [],
    brakeHistory = [],
    miniChart,
  } = $props<{
    vehicleState: Record<string, unknown>;
    speedHistory?: number[];
    throttleHistory?: number[];
    brakeHistory?: number[];
    miniChart: (data: number[], color: string, maxVal?: number) => string;
  }>();
</script>

<SurfaceCard
  title="Live Telemetry"
  subtitle="Current state of simulated vehicle in the active scenario."
>
  <div class="telemetry-chart-grid mb-4">
    <div class="telemetry-tile">
      <div class="telemetry-tile__header">
        <span class="telemetry-tile__label">Speed</span>
        <span class="telemetry-tile__value"
          >{vehicleState.speed ?? "—"} <small>km/h</small></span
        >
      </div>
      {#if speedHistory.length > 1}
        <div class="telemetry-tile__chart">
          {@html miniChart(speedHistory, "#245f88", undefined)}
        </div>
      {:else}
        <div class="telemetry-tile__chart telemetry-tile__chart--empty">
          Awaiting stream
        </div>
      {/if}
    </div>
    <div class="telemetry-tile">
      <div class="telemetry-tile__header">
        <span class="telemetry-tile__label">Throttle</span>
        <span class="telemetry-tile__value"
          >{Math.round(Number(vehicleState.throttle ?? 0) * 100)}%</span
        >
      </div>
      {#if throttleHistory.length > 1}
        <div class="telemetry-tile__chart">
          {@html miniChart(throttleHistory, "#1f7a45", 1)}
        </div>
      {:else}
        <div class="telemetry-tile__chart telemetry-tile__chart--empty">
          Awaiting stream
        </div>
      {/if}
    </div>
    <div class="telemetry-tile">
      <div class="telemetry-tile__header">
        <span class="telemetry-tile__label">Brake</span>
        <span class="telemetry-tile__value"
          >{Math.round(Number(vehicleState.brake ?? 0) * 100)}%</span
        >
      </div>
      {#if brakeHistory.length > 1}
        <div class="telemetry-tile__chart">
          {@html miniChart(brakeHistory, "#946200", 1)}
        </div>
      {:else}
        <div class="telemetry-tile__chart telemetry-tile__chart--empty">
          Awaiting stream
        </div>
      {/if}
    </div>
    <div class="telemetry-tile">
      <div class="telemetry-tile__header">
        <span class="telemetry-tile__label">Steer</span>
        <span class="telemetry-tile__value">{vehicleState.steer ?? "—"}</span>
      </div>
      <div class="telemetry-tile__chart telemetry-tile__chart--empty">
        Heading: {vehicleState.heading ?? "—"}
      </div>
    </div>
  </div>
  <div class="mt-3 border-t border-[--color-line] pt-3">
    <KeyValueGrid
      items={[
        { label: "Speed Limit", value: vehicleState.speedLimit ?? "—" },
      ]}
    />
  </div>
</SurfaceCard>

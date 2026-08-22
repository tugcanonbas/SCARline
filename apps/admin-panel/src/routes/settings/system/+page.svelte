<script lang="ts">
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";

  let { data } = $props();
  const processItems = $derived(
    Object.entries(data.processManager ?? {}).map(([label, value]) => ({
      label,
      value,
    })),
  );
  const pmReachable = $derived(!data.processManager?.unavailable);
</script>

<div class="metric-grid">
  <MetricCard
    label="Process Manager"
    value={pmReachable ? "Ready" : "Down"}
    hint="IPC-backed status and controls"
  />
  <MetricCard
    label="Platform Port"
    value={data.configuration.platformPort ?? 8088}
    hint="Single-domain Nginx entrypoint"
  />
  <MetricCard
    label="CARLA Port"
    value={data.configuration.carlaServerPort ?? 2000}
    hint="Simulator server endpoint"
  />
  <MetricCard
    label="Overlay"
    value={data.configuration.transparentOverlayEnabled ? "On" : "Off"}
    hint="Transparent shell startup setting"
  />
</div>

<div class="section-grid section-grid--sidebar mt-4">
  <SurfaceCard
    title="Platform Configuration"
    subtitle="Persisted system configuration used by the launcher and CoreAPI."
  >
    <form class="form-stack" method="POST" action="?/update">
      <label class="form-field">
        <span>CARLA Server Path</span>
        <input
          name="carlaServerPath"
          placeholder="/opt/carla/CarlaUE4.sh"
          value={data.configuration.carlaServerPath ?? ""}
        />
      </label>
      <label class="form-field">
        <span>Data Directory</span>
        <input
          name="dataDirectory"
          required
          value={data.configuration.dataDirectory ?? ".scarline-runtime"}
        />
      </label>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Platform Port</span>
          <input
            min="1"
            name="platformPort"
            required
            type="number"
            value={data.configuration.platformPort ?? 8088}
          />
        </label>
        <label class="form-field">
          <span>CARLA Server Port</span>
          <input
            min="1"
            name="carlaServerPort"
            required
            type="number"
            value={data.configuration.carlaServerPort ?? 2000}
          />
        </label>
      </div>
      <label class="form-choice-card">
        <input
          class="size-4"
          name="transparentOverlayEnabled"
          type="checkbox"
          checked={data.configuration.transparentOverlayEnabled}
        />
        <span>Enable transparent overlay shell on startup</span>
      </label>
      <div class="form-actions">
        <button class="button-primary" type="submit">Save Configuration</button>
      </div>
    </form>
  </SurfaceCard>

  <div class="content-stack">
    <SurfaceCard
      title="Process Manager"
      subtitle="Current IPC response from the OS-level launcher."
    >
      <div class="mb-4">
        <StatusBadge
          status={data.processManager?.unavailable ? "disconnected" : "running"}
          label={data.processManager?.unavailable ? "Unavailable" : "Reachable"}
        />
      </div>
      <KeyValueGrid items={processItems} />
    </SurfaceCard>

    <SurfaceCard
      title="Runtime Controls"
      subtitle="Only implemented server actions are exposed here."
    >
      <div class="content-stack">
        <form class="detail-grid-3" method="POST" action="?/carla">
          {#each ["start", "stop", "restart"] as action}
            <button
              class="button-secondary capitalize"
              name="action"
              type="submit"
              value={action}
            >
              CARLA {action}
            </button>
          {/each}
        </form>
        <form method="POST" action="?/overlayReload">
          <button class="button-secondary button-block" type="submit">
            Reload Transparent Overlay
          </button>
        </form>
        <div class="technical-panel">
          <p class="technical-label">System restart</p>
          <p class="technical-value">
            No restart-system action is currently exposed by this route; use the
            Process Manager command line for full restart.
          </p>
        </div>
      </div>
    </SurfaceCard>
  </div>
</div>

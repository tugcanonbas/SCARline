<script lang="ts">
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatStatusLabel } from "$lib/format";

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
    label="Simulator Port"
    value={data.configuration.carlaServerPort ?? 2000}
    hint="Default simulator: CARLA"
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
    subtitle="Global system and application settings."
  >
    <p class="form-field__hint mb-4">
      The default simulator is <strong>CARLA</strong>, a free, open-source
      driving simulator. These fields tell SCARline where to find it — leave
      them as-is unless you're running a custom simulator setup.
    </p>
    <form class="form-stack" method="POST" action="?/update">
      <label class="form-field">
        <span>Simulator Path (Default: CARLA)</span>
        <input
          name="carlaServerPath"
          placeholder="/opt/carla/CarlaUE4.sh"
          value={data.configuration.carlaServerPath ?? ""}
        />
        <span class="form-field__hint"
          >Path to the simulator executable on this machine.</span
        >
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
          <span>Simulator Port (Default: CARLA)</span>
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
      <p class="form-field__hint">
        Shows the participant-facing display with a see-through background,
        so it can sit on top of the simulator view during a study instead of
        covering it.
      </p>
      <div class="form-actions">
        <button class="button-primary" type="submit">Save Configuration</button>
      </div>
    </form>
  </SurfaceCard>

  <div class="content-stack">
    <SurfaceCard
      title="Process Manager"
      subtitle="Real-time status of the background process manager."
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
              class="button-secondary"
              name="action"
              type="submit"
              value={action}
            >
              {formatStatusLabel(action)} Simulator
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
            A full system restart isn't available from this page. Contact your
            system administrator to restart the SCARline services.
          </p>
        </div>
      </div>
    </SurfaceCard>
  </div>
</div>

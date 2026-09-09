<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import KeyValueGrid from "$lib/components/KeyValueGrid.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate, formatStatusLabel } from "$lib/format";

  let { data } = $props();
  let copiedCommand = $state("");

  function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  const configuration = $derived(asRecord(data.system.configuration));
  const components = $derived(
    Array.isArray(data.system.components) ? data.system.components : [],
  );
  const readinessComponents = $derived(
    Array.isArray(data.readiness?.components) ? data.readiness.components : [],
  );
  const overlay = $derived(asRecord(data.system.overlay));
  const overlayHosts = $derived(
    Array.isArray(overlay.hosts) ? overlay.hosts : [],
  );
  const simulatorReady = $derived(
    components.some(
      (component: Record<string, unknown>) =>
        component.component === "sim-bridge" && component.available === true,
    ),
  );
  const configurationItems = $derived([
    { label: "Environment", value: configuration.environment ?? "Unknown" },
    { label: "Platform Port", value: configuration.platformPort ?? "Unknown" },
    { label: "Runtime Directory", value: configuration.runtimeDirectory ?? "Unknown" },
    { label: "Default Simulator", value: formatStatusLabel(String(configuration.simulatorDefault ?? "unknown")) },
    { label: "Simulator Autostart", value: configuration.simulatorAutostart ? "Enabled" : "Disabled" },
    { label: "CARLA Executable", value: configuration.carlaConfigured ? "Configured" : "Not configured" },
    { label: "CARLA Port", value: configuration.carlaPort ?? "Unknown" },
    { label: "Admin Panel Port", value: configuration.adminPanelPort ?? "Unknown" },
    { label: "Overlay Web", value: configuration.overlayWebOrigin ?? "Disabled" },
    { label: "Desktop Overlay", value: configuration.desktopOverlayEnabled ? "Enabled" : "Disabled" },
    { label: "IO Client", value: configuration.ioClientEnabled ? `Enabled (${configuration.ioClientRuntime})` : "Disabled" },
    { label: "Log Level", value: configuration.loggingLevel ?? "Unknown" },
  ]);
  const cliCommands = [
    { label: "Inspect platform status", command: "scarline status" },
    { label: "Start configured services", command: "scarline start" },
    { label: "Stop configured services", command: "scarline stop" },
    { label: "Validate configuration", command: "scarline doctor" },
  ];

  async function handleCopy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      copiedCommand = command;
    } catch {
      copiedCommand = "";
    }
  }
</script>

<div class="metric-grid">
  <MetricCard
    label="Core API"
    value={data.readiness?.status === "healthy" ? "Ready" : "Not Ready"}
    hint={`Checked ${formatDate(data.readiness?.checkedAt)}`}
  />
  <MetricCard
    label="Bootstrap"
    value={data.system.bootstrapCompleted ? "Complete" : "Pending"}
    hint="Initial administrator state"
  />
  <MetricCard
    label="Simulator / IO"
    value={simulatorReady ? "Ready" : "Not Ready"}
    hint={`${components.length} runtime component${components.length === 1 ? "" : "s"} reported`}
  />
  <MetricCard
    label="Desktop Overlay"
    value={overlay.connected ? "Connected" : "Disconnected"}
    hint={`${overlayHosts.filter((host: Record<string, unknown>) => host.connected === true).length} connected host${overlayHosts.filter((host: Record<string, unknown>) => host.connected === true).length === 1 ? "" : "s"}`}
  />
</div>

<div class="section-grid section-grid--sidebar mt-4">
  <SurfaceCard
    title="Platform Configuration"
    subtitle="Safe read-only values loaded from config.yml. Secrets are never shown here."
  >
    <KeyValueGrid items={configurationItems} />
    <p class="form-field__hint mt-4">
      Configuration is owned by <strong>{configuration.configurationOwner ?? "config.yml"}</strong> and process lifecycle is owned by the <strong>{configuration.processOwner ?? "SCARline CLI"}</strong>.
    </p>
  </SurfaceCard>

  <div class="content-stack">
    <SurfaceCard
      title="Core API Readiness"
      subtitle="Database, messaging, and administrator bootstrap readiness."
    >
      <div class="list-stack">
        {#each readinessComponents as component}
          <div class="entity-card entity-card--tight">
            <div class="entity-card__header">
              <div>
                <p class="entity-card__title">{formatStatusLabel(String(component.componentId ?? "component"))}</p>
                <p class="entity-card__meta">{component.message ?? "No readiness issue reported"}</p>
              </div>
              <StatusBadge status={String(component.status ?? "unknown")} />
            </div>
          </div>
        {/each}
      </div>
    </SurfaceCard>

    <SurfaceCard
      title="Runtime Components"
      subtitle="Simulator and IO hosts currently reporting to Core API."
    >
      <div class="list-stack">
        {#each components as component}
          <div class="entity-card entity-card--tight">
            <div class="entity-card__header">
              <div>
                <p class="entity-card__title">{formatStatusLabel(String(component.component ?? "component"))}</p>
                <p class="entity-card__meta">
                  {Array.isArray(component.adapters) && component.adapters.length > 0
                    ? `Adapters: ${component.adapters.join(", ")}`
                    : "No adapters reported"}
                </p>
              </div>
              <StatusBadge status={component.available ? "connected" : "disconnected"} label={component.available ? "Available" : "Unavailable"} />
            </div>
          </div>
        {:else}
          <p class="entity-card__meta">No simulator or IO components are currently reporting.</p>
        {/each}
      </div>
    </SurfaceCard>
  </div>
</div>

<div class="section-grid section-grid--balanced mt-4">
  <SurfaceCard
    title="Desktop Hosts"
    subtitle="Host-specific overlay connection and display status."
  >
    <div class="list-stack">
      {#each overlayHosts as host}
        <div class="entity-card entity-card--tight">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">{host.hostId}</p>
              <p class="entity-card__meta">{Array.isArray(host.displays) ? host.displays.length : 0} display(s) · Last seen {formatDate(host.lastSeenAt)}</p>
            </div>
            <StatusBadge status={host.connected ? "connected" : "disconnected"} />
          </div>
        </div>
      {:else}
        <p class="entity-card__meta">No desktop overlay host has connected yet.</p>
      {/each}
    </div>
  </SurfaceCard>

  <SurfaceCard
    title="CLI Guidance"
    subtitle="Run these commands from the SCARline repository root."
  >
    {#if copiedCommand}
      <InlineNotice tone="success" message={`Copied: ${copiedCommand}`} />
    {/if}
    <div class="list-stack">
      {#each cliCommands as item}
        <label class="form-field">
          <span>{item.label}</span>
          <div class="toolbar">
            <input readonly value={item.command} />
            <button class="button-secondary" type="button" title={`Copy ${item.command}`} onclick={() => handleCopy(item.command)}>Copy</button>
          </div>
        </label>
      {/each}
    </div>
  </SurfaceCard>
</div>

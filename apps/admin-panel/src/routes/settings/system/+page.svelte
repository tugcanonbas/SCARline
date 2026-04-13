<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const processItems = $derived(
    Object.entries(data.processManager ?? {}).map(([label, value]) => ({ label, value }))
  );
  const pmReachable = $derived(!data.processManager?.unavailable);
</script>

<PageHeader
  eyebrow="System"
  title="System Settings"
  description="Runtime configuration and Process Manager controls for the current SCARline lab node."
/>

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Process Manager</p>
    <p class="metric-card__value">{pmReachable ? 'Ready' : 'Down'}</p>
    <p class="metric-card__hint">IPC-backed status and controls</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Platform Port</p>
    <p class="metric-card__value">{data.configuration.platformPort ?? 8088}</p>
    <p class="metric-card__hint">Single-domain Nginx entrypoint</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">CARLA Port</p>
    <p class="metric-card__value">{data.configuration.carlaServerPort ?? 2000}</p>
    <p class="metric-card__hint">Simulator server endpoint</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Overlay</p>
    <p class="metric-card__value">{data.configuration.transparentOverlayEnabled ? 'On' : 'Off'}</p>
    <p class="metric-card__hint">Transparent shell startup setting</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
  <SurfaceCard title="Platform Configuration" subtitle="Persisted system configuration used by the launcher and CoreAPI.">
    <form class="grid gap-4" method="POST" action="?/update">
      <label class="grid gap-2 text-sm">
        <span>CARLA Server Path</span>
        <input
          class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
          name="carlaServerPath"
          placeholder="/opt/carla/CarlaUE4.sh"
          value={data.configuration.carlaServerPath ?? ''}
        />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Data Directory</span>
        <input
          class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
          name="dataDirectory"
          required
          value={data.configuration.dataDirectory ?? '.scarline-runtime'}
        />
      </label>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Platform Port</span>
          <input
            class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
            min="1"
            name="platformPort"
            required
            type="number"
            value={data.configuration.platformPort ?? 8088}
          />
        </label>
        <label class="grid gap-2 text-sm">
          <span>CARLA Server Port</span>
          <input
            class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
            min="1"
            name="carlaServerPort"
            required
            type="number"
            value={data.configuration.carlaServerPort ?? 2000}
          />
        </label>
      </div>
      <label class="flex items-center gap-3 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
        <input
          class="size-4"
          name="transparentOverlayEnabled"
          type="checkbox"
          checked={data.configuration.transparentOverlayEnabled}
        />
        <span>Enable transparent overlay shell on startup</span>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">
        Save Configuration
      </button>
    </form>
  </SurfaceCard>

  <div class="grid gap-4">
    <SurfaceCard title="Process Manager" subtitle="Current IPC response from the OS-level launcher.">
      <div class="mb-4">
        <StatusBadge status={data.processManager?.unavailable ? 'disconnected' : 'running'} label={data.processManager?.unavailable ? 'Unavailable' : 'Reachable'} />
      </div>
      <KeyValueGrid items={processItems} />
    </SurfaceCard>

    <SurfaceCard title="Runtime Controls" subtitle="Only implemented server actions are exposed here.">
      <div class="grid gap-3">
        <form class="grid grid-cols-3 gap-2" method="POST" action="?/carla">
          {#each ['start', 'stop', 'restart'] as action}
            <button
              class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm capitalize"
              name="action"
              type="submit"
              value={action}
            >
              CARLA {action}
            </button>
          {/each}
        </form>
        <form method="POST" action="?/overlayReload">
          <button class="w-full rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" type="submit">
            Reload Transparent Overlay
          </button>
        </form>
        <div class="technical-panel">
          <p class="technical-label">System restart</p>
          <p class="technical-value">No restart-system action is currently exposed by this route; use the Process Manager command line for full restart.</p>
        </div>
      </div>
    </SurfaceCard>
  </div>
</div>

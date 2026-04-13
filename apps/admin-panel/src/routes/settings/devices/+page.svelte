<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader
  eyebrow="System"
  title="Devices"
  description="Register lab hardware, monitor live status, and keep display/runtime metadata aligned with the device registry."
/>

<div class="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
  <SurfaceCard title="Register Device">
    <form class="grid gap-4" method="POST" action="?/create">
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Name</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" required />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Type</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="type" placeholder="sensor, simulator, overlay" required />
        </label>
      </div>
      <label class="grid gap-2 text-sm">
        <span>Status</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="status">
          <option value="disconnected">disconnected</option>
          <option value="ready">ready</option>
          <option value="running">running</option>
          <option value="degraded">degraded</option>
          <option value="error">error</option>
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Configuration JSON</span>
        <textarea class="min-h-24 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 font-mono text-xs" name="configuration">{'{}'}</textarea>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Register Device</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Device Registry">
    <form class="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="GET">
      <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="type" placeholder="Filter type" value={data.filters.type} />
      <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="status" placeholder="Filter status" value={data.filters.status} />
      <button class="rounded-2xl border border-[--color-line] px-4 py-3 text-sm" type="submit">Filter</button>
    </form>

    <div class="space-y-4">
      {#each data.devices as device}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <form class="grid gap-3" method="POST" action="?/update">
            <input name="deviceId" type="hidden" value={device.id} />
            <div class="grid gap-3 md:grid-cols-[1fr_0.7fr_0.7fr]">
              <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm" name="name" value={device.name} />
              <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm" name="type" value={device.type} />
              <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm" name="status" value={device.status} />
            </div>
            <div class="grid gap-3 md:grid-cols-3">
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Configuration</span>
                <textarea class="min-h-24 rounded-2xl border border-[--color-line] bg-black/20 px-3 py-2 font-mono text-xs text-slate-200" name="configuration">{JSON.stringify(device.configuration ?? {}, null, 2)}</textarea>
              </label>
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Display</span>
                <textarea class="min-h-24 rounded-2xl border border-[--color-line] bg-black/20 px-3 py-2 font-mono text-xs text-slate-200" name="displayConfiguration">{JSON.stringify(device.display_configuration ?? device.displayConfiguration ?? {}, null, 2)}</textarea>
              </label>
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Metadata</span>
                <textarea class="min-h-24 rounded-2xl border border-[--color-line] bg-black/20 px-3 py-2 font-mono text-xs text-slate-200" name="metadata">{JSON.stringify(device.metadata ?? {}, null, 2)}</textarea>
              </label>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span>{device.status_message ?? device.statusMessage ?? 'No status message'} · Last seen {device.last_seen_at ?? device.lastSeenAt ?? 'never'}</span>
              <div class="flex gap-2">
                <button class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-200" type="submit">Save</button>
              </div>
            </div>
          </form>
          <form class="mt-2" method="POST" action="?/delete">
            <input name="deviceId" type="hidden" value={device.id} />
            <button class="rounded-full border border-[--color-danger]/40 px-3 py-1 text-xs text-red-200" type="submit">Delete</button>
          </form>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No devices match the current filter.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

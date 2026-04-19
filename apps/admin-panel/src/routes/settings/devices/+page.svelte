<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader
  eyebrow="System"
  title="Devices"
  description="Register lab hardware, monitor live status, and keep display/runtime metadata aligned with the device registry."
/>

<div class="section-grid section-grid--sidebar">
  <SurfaceCard title="Register Device">
    <form class="form-stack" method="POST" action="?/create">
      <div class="form-grid-2">
        <label class="form-field">
          <span>Name</span>
          <input name="name" required />
        </label>
        <label class="form-field">
          <span>Type</span>
          <input name="type" placeholder="sensor, simulator, overlay" required />
        </label>
      </div>
      <label class="form-field">
        <span>Status</span>
        <select name="status">
          <option value="disconnected">disconnected</option>
          <option value="ready">ready</option>
          <option value="running">running</option>
          <option value="degraded">degraded</option>
          <option value="error">error</option>
        </select>
      </label>
      <label class="form-field">
        <span>Configuration JSON</span>
        <textarea class="min-h-24 font-mono text-xs" name="configuration">{'{}'}</textarea>
      </label>
      <div class="form-actions">
        <button class="button-primary" type="submit">Register Device</button>
      </div>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Device Registry">
    <form class="toolbar" method="GET">
      <input class="toolbar__grow" name="type" placeholder="Filter type" value={data.filters.type} />
      <input class="toolbar__grow" name="status" placeholder="Filter status" value={data.filters.status} />
      <button class="button-secondary" type="submit">Filter</button>
    </form>

    <div class="list-stack">
      {#each data.devices as device}
        <div class="entity-card">
          <form class="form-stack" method="POST" action="?/update">
            <input name="deviceId" type="hidden" value={device.id} />
            <div class="detail-grid-3">
              <input name="name" value={device.name} />
              <input name="type" value={device.type} />
              <input name="status" value={device.status} />
            </div>
            <div class="detail-grid-3">
              <label class="form-field form-field--compact">
                <span>Configuration</span>
                <textarea class="min-h-24 font-mono text-xs" name="configuration">{JSON.stringify(device.configuration ?? {}, null, 2)}</textarea>
              </label>
              <label class="form-field form-field--compact">
                <span>Display</span>
                <textarea class="min-h-24 font-mono text-xs" name="displayConfiguration">{JSON.stringify(device.display_configuration ?? device.displayConfiguration ?? {}, null, 2)}</textarea>
              </label>
              <label class="form-field form-field--compact">
                <span>Metadata</span>
                <textarea class="min-h-24 font-mono text-xs" name="metadata">{JSON.stringify(device.metadata ?? {}, null, 2)}</textarea>
              </label>
            </div>
            <div class="toolbar">
              <span>{device.status_message ?? device.statusMessage ?? 'No status message'} · Last seen {device.last_seen_at ?? device.lastSeenAt ?? 'never'}</span>
              <div class="toolbar__end">
                <button class="button-chip" type="submit">Save</button>
              </div>
            </div>
          </form>
          <form class="mt-2" method="POST" action="?/delete">
            <input name="deviceId" type="hidden" value={device.id} />
            <button class="button-danger" type="submit">Delete</button>
          </form>
        </div>
      {:else}
        <EmptyState message="No devices match the current filter." />
      {/each}
    </div>
  </SurfaceCard>
</div>

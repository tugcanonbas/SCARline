<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { formatDate, formatStatusLabel } from '$lib/format';

  let { data } = $props();
</script>

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
          <option value="disconnected">{formatStatusLabel('disconnected')}</option>
          <option value="ready">{formatStatusLabel('ready')}</option>
          <option value="running">{formatStatusLabel('running')}</option>
          <option value="degraded">{formatStatusLabel('degraded')}</option>
          <option value="error">{formatStatusLabel('error')}</option>
        </select>
      </label>
      <details>
        <summary>Advanced: raw configuration (JSON)</summary>
        <div class="form-field mt-2">
          <span class="form-field__hint">
            Most devices don't need this — leave it as <code>{'{}'}</code>
            unless you know the specific configuration keys this device type
            expects.
          </span>
          <textarea class="min-h-24 font-mono text-xs" name="configuration">{'{}'}</textarea>
        </div>
      </details>
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
              <select name="status">
                <option value="disconnected" selected={device.status === 'disconnected'}>{formatStatusLabel('disconnected')}</option>
                <option value="ready" selected={device.status === 'ready'}>{formatStatusLabel('ready')}</option>
                <option value="running" selected={device.status === 'running'}>{formatStatusLabel('running')}</option>
                <option value="degraded" selected={device.status === 'degraded'}>{formatStatusLabel('degraded')}</option>
                <option value="error" selected={device.status === 'error'}>{formatStatusLabel('error')}</option>
              </select>
            </div>
            <details>
              <summary>Advanced: raw configuration (JSON)</summary>
              <div class="detail-grid-3 mt-2">
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
            </details>
            <div class="toolbar">
              <span>{device.status_message ?? device.statusMessage ?? 'No status message'} · Last seen {formatDate(device.last_seen_at ?? device.lastSeenAt, 'never')}</span>
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

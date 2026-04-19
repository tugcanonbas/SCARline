<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { sensorStatuses = [], sensorTitle } = $props<{
    sensorStatuses?: Array<Record<string, unknown>>;
    sensorTitle: (status: Record<string, unknown>) => string;
  }>();
</script>

<SurfaceCard title="Sensor Status" subtitle="Latest sensor health events received through the realtime channel.">
  <div class="list-stack">
    {#each sensorStatuses as status}
      <div class="scarline-list-item">
        <div class="entity-card__header">
          <div>
            <p class="entity-card__title">{sensorTitle(status)}</p>
            <p class="entity-card__meta">{status.message ?? status.status ?? 'No message'}</p>
          </div>
          <StatusBadge status={String(status.status ?? 'unknown')} />
        </div>
      </div>
    {:else}
      <EmptyState message="Waiting for sensor status events." />
    {/each}
  </div>
</SurfaceCard>

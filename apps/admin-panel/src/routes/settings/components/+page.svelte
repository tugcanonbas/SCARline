<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Observability" title="Component Health" description="Current service state, used for lab bring-up and runtime monitoring." />

<SurfaceCard title="Component Status">
  <div class="detail-grid-3">
    {#each data.components as component}
      <div class="entity-card entity-card--tight">
        <div class="entity-card__header">
          <div>
            <p class="entity-card__title">{component.componentName ?? component.component_name ?? component.componentId}</p>
            <p class="entity-card__meta">{component.componentId ?? component.component_id}</p>
          </div>
          <StatusBadge status={component.status} />
        </div>
        <p class="entity-card__meta">{component.message ?? 'No component message'}</p>
        <p class="entity-card__meta">Checked {component.checkedAt ?? component.checked_at ?? 'unknown'}</p>
      </div>
    {:else}
      <EmptyState message="No component health records are available." />
    {/each}
  </div>
</SurfaceCard>

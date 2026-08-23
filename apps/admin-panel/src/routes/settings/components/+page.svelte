<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate } from "$lib/format";

  let { data } = $props();
</script>

<div class="detail-grid-3">
  {#each data.components as component}
    {@const componentName = component.componentName ?? component.component_name}
    {@const componentId = component.componentId ?? component.component_id}
    <div class="entity-card entity-card--tight">
      <div class="entity-card__header">
        <div>
          <p class="entity-card__title">
            {componentName ?? componentId ?? "Unknown component"}
          </p>
          {#if componentName}
            <p class="entity-card__meta">{componentId}</p>
          {/if}
        </div>
        <StatusBadge status={component.status} />
      </div>
      <p class="entity-card__meta">
        {component.message ?? "No component message"}
      </p>
      <p class="entity-card__meta">
        Checked {formatDate(component.checkedAt ?? component.checked_at)}
      </p>
    </div>
  {:else}
    <EmptyState message="No component health records are available." />
  {/each}
</div>

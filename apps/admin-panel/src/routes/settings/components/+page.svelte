<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate } from "$lib/format";

  let { data } = $props();

  const componentDescriptions: Record<string, string> = {
    "admin-panel": "Web interface for managing SCARline studies.",
    "core-api": "Coordinates studies and handles API requests.",
    database: "Stores all study data (primary PostgreSQL).",
    "mock-simulator": "Provides a simulated sensor environment.",
    "overlay-web": "Shows researcher overlay during sessions.",
    rabbitmq:
      "Handles real-time messaging between services (AMQP message broker).",
    "sim-bridge": "Connects SCARline to the simulator.",
    "io-client": "Collects input/output data from devices.",
    "io-server": "Routes collected I/O data to the platform.",
  };

  function getComponentDescription(
    id: string | null | undefined,
    name: string | null | undefined,
  ) {
    if (id && componentDescriptions[id]) return componentDescriptions[id];
    if (name && componentDescriptions[name]) return componentDescriptions[name];
    return "Core system component.";
  }
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
      <p class="mt-1 text-[13px] text-[var(--scarline-white-72)]">
        {getComponentDescription(componentId, componentName)}
      </p>
      <div class="mt-2">
        <p class="entity-card__meta">
          {component.message ?? "No component message"}
        </p>
        <p class="entity-card__meta">
          Checked {formatDate(component.checkedAt ?? component.checked_at)}
        </p>
      </div>
    </div>
  {:else}
    <EmptyState message="No component health records are available." />
  {/each}
</div>

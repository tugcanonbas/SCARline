<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Observability" title="Component Health" description="Current service state, used for lab bring-up and runtime monitoring." />

<SurfaceCard title="Component Status">
  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    {#each data.components as component}
      <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-white">{component.componentName ?? component.component_name ?? component.componentId}</p>
            <p class="text-xs text-slate-500">{component.componentId ?? component.component_id}</p>
          </div>
          <StatusBadge status={component.status} />
        </div>
        <p class="text-sm text-slate-400">{component.message ?? 'No component message'}</p>
        <p class="mt-3 text-xs text-slate-500">Checked {component.checkedAt ?? component.checked_at ?? 'unknown'}</p>
      </div>
    {:else}
      <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No component health records are available.</p>
    {/each}
  </div>
</SurfaceCard>

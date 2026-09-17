<script lang="ts">
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import { appPath } from '$lib/paths';
  import type { WidgetBindingData } from '@scarline/contracts';

  let { sessionId = '' } = $props<{ sessionId?: string }>();
  type WidgetData = { instanceId: string; name: string; layout: string;
    bindings: Record<string, WidgetBindingData & { value?: unknown }> };
  let widgets = $state<WidgetData[]>([]);
  let failure = $state('');
  let now = $state(Date.now());
  $effect(() => {
    const selected = sessionId;
    widgets = []; failure = '';
    if (!selected) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(appPath(`/api/sessions/${selected}/widgets/data`), { signal: abort.signal });
        if (!response.ok) throw new Error('Widget data status is unavailable.');
        const result = await response.json() as { data: WidgetData[] };
        if (!abort.signal.aborted) { widgets = result.data; failure = ''; now = Date.now(); }
      } catch {
        if (!abort.signal.aborted) { widgets = []; failure = 'Widget data status is unavailable.'; }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 2_000);
      }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  });
</script>

<SurfaceCard title="Widget data sources" subtitle="Inspect the source and freshness of each value in the active condition.">
  {#if failure}
    <EmptyState message={failure} />
  {:else}
    <div class="list-stack">
      {#each widgets as widget (widget.instanceId)}
        <details class="entity-card entity-card--tight">
          <summary class="entity-card__title">{widget.name} · {widget.layout}</summary>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead><tr><th class="p-2">Binding / value</th><th class="p-2">Source</th><th class="p-2">Status</th><th class="p-2">Last sample</th></tr></thead>
              <tbody>
                {#each Object.entries(widget.bindings) as [key, binding] (key)}
                  <tr class="border-t">
                    <td class="p-2">{key}<br />{binding.value === null || binding.value === undefined ? '—' : String(binding.value)}</td>
                    <td class="p-2">{binding.sourceKey ?? binding.source}<br />{binding.path}</td>
                    <td class="p-2">{binding.simulated ? 'Simulated' : binding.source} · {binding.status}</td>
                    <td class="p-2" title={binding.timestamp === null ? '' : new Date(binding.timestamp).toISOString()}>
                      {binding.timestamp === null ? '—' : `${Math.max(0, Math.floor((now - binding.timestamp) / 1000))}s ago`}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {:else}
        <EmptyState message={sessionId ? 'No widget data in an active condition.' : 'Select a session to inspect widget data.'} />
      {/each}
    </div>
  {/if}
</SurfaceCard>

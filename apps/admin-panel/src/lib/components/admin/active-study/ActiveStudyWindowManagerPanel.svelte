<script lang="ts">
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let {
    windowUpdateStatus,
    windowDrafts = [],
    canOperate = false,
    updateDraft,
    nudgeWindow,
    resizeWindow,
    applyWindowUpdate
  } = $props<{
    windowUpdateStatus: { ok: boolean; message: string } | null;
    windowDrafts?: Array<{
      instanceId: string;
      widgetId: string;
      mode: 'transparent_electron' | 'browser_popup';
      order: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    canOperate?: boolean;
    updateDraft: (instanceId: string, patch: Record<string, unknown>) => void;
    nudgeWindow: (
      entry: {
        instanceId: string;
        widgetId: string;
        mode: 'transparent_electron' | 'browser_popup';
        order: number;
        x: number;
        y: number;
        width: number;
        height: number;
      },
      dx?: number,
      dy?: number,
    ) => void;
    resizeWindow: (
      entry: {
        instanceId: string;
        widgetId: string;
        mode: 'transparent_electron' | 'browser_popup';
        order: number;
        x: number;
        y: number;
        width: number;
        height: number;
      },
      dw?: number,
      dh?: number,
    ) => void;
    applyWindowUpdate: (instanceId: string) => void;
  }>();
</script>

<SurfaceCard title="Window Manager" subtitle="Operator-only runtime move/resize controls. Changes persist to the participant layout.">
  {#if windowUpdateStatus}
    <InlineNotice tone={windowUpdateStatus.ok ? 'success' : 'danger'} message={windowUpdateStatus.message} />
  {/if}
  <div class="list-stack">
    {#each windowDrafts as entry}
      <div class="entity-card entity-card--tight">
        <div class="entity-card__header">
          <p class="entity-card__title">{entry.widgetId}</p>
          <span class="status-badge status-badge--muted">{entry.mode === 'browser_popup' ? 'Browser window' : 'Electron transparent'}</span>
        </div>
        <div class="detail-grid-3">
          <label class="form-field form-field--compact">X
            <input type="number" value={entry.x} oninput={(event) => updateDraft(String(entry.instanceId), { x: Number((event.currentTarget as HTMLInputElement).value || 0) })} />
          </label>
          <label class="form-field form-field--compact">Y
            <input type="number" value={entry.y} oninput={(event) => updateDraft(String(entry.instanceId), { y: Number((event.currentTarget as HTMLInputElement).value || 0) })} />
          </label>
          <label class="form-field form-field--compact">W
            <input type="number" value={entry.width} oninput={(event) => updateDraft(String(entry.instanceId), { width: Math.max(1, Number((event.currentTarget as HTMLInputElement).value || 1)) })} />
          </label>
          <label class="form-field form-field--compact">H
            <input type="number" value={entry.height} oninput={(event) => updateDraft(String(entry.instanceId), { height: Math.max(1, Number((event.currentTarget as HTMLInputElement).value || 1)) })} />
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="button-chip" onclick={() => nudgeWindow(entry, -10, 0)}>←10</button>
          <button type="button" class="button-chip" onclick={() => nudgeWindow(entry, 10, 0)}>10→</button>
          <button type="button" class="button-chip" onclick={() => nudgeWindow(entry, 0, -10)}>↑10</button>
          <button type="button" class="button-chip" onclick={() => nudgeWindow(entry, 0, 10)}>↓10</button>
          <button type="button" class="button-chip" onclick={() => resizeWindow(entry, 20, 20)}>+20 size</button>
          <button type="button" class="button-chip" onclick={() => resizeWindow(entry, -20, -20)}>-20 size</button>
          {#if canOperate}
            <button type="button" class="button-secondary" onclick={() => applyWindowUpdate(String(entry.instanceId))}>Apply</button>
          {/if}
        </div>
      </div>
    {:else}
      <EmptyState message="No widget windows in participant layout." />
    {/each}
  </div>
</SurfaceCard>

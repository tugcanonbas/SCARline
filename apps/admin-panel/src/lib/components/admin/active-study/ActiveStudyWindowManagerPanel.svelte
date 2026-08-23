<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";

  let {
    windowUpdateStatus,
    windowDrafts = [],
    savedWindows = {},
    canOperate = false,
    updateDraft,
    applyWindowUpdate,
  } = $props<{
    windowUpdateStatus: { ok: boolean; message: string } | null;
    windowDrafts?: Array<{
      instanceId: string;
      widgetId: string;
      mode: "transparent_electron" | "browser_popup";
      order: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    savedWindows?: Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    canOperate?: boolean;
    updateDraft: (instanceId: string, patch: Record<string, unknown>) => void;
    applyWindowUpdate: (instanceId: string) => void;
  }>();

  function isUnsaved(entry: (typeof windowDrafts)[number]) {
    const saved = savedWindows[entry.instanceId];
    if (!saved) return false;
    return (
      saved.x !== entry.x ||
      saved.y !== entry.y ||
      saved.width !== entry.width ||
      saved.height !== entry.height
    );
  }
</script>

<SurfaceCard
  title="Window Manager"
  subtitle="Adjust window position and size below, then click Apply to save that window's changes to the layout."
>
  {#if windowUpdateStatus}
    <InlineNotice
      tone={windowUpdateStatus.ok ? "success" : "danger"}
      message={windowUpdateStatus.message}
    />
  {/if}
  <div class="list-stack">
    {#each windowDrafts as entry}
      <div class="entity-card entity-card--tight">
        <div class="entity-card__header">
          <p class="entity-card__title">{entry.widgetId}</p>
          <div class="pill-row" style="margin-bottom: 0;">
            {#if isUnsaved(entry)}
              <span class="status-badge status-badge--warning"
                >Unsaved changes</span
              >
            {/if}
            <span class="status-badge status-badge--muted"
              >{entry.mode === "browser_popup"
                ? "Browser window"
                : "Transparent overlay"}</span
            >
          </div>
        </div>
        <div class="detail-grid-3">
          <label class="form-field form-field--compact"
            >X
            <input
              type="number"
              value={entry.x}
              oninput={(event) =>
                updateDraft(String(entry.instanceId), {
                  x: Number(
                    (event.currentTarget as HTMLInputElement).value || 0,
                  ),
                })}
            />
          </label>
          <label class="form-field form-field--compact"
            >Y
            <input
              type="number"
              value={entry.y}
              oninput={(event) =>
                updateDraft(String(entry.instanceId), {
                  y: Number(
                    (event.currentTarget as HTMLInputElement).value || 0,
                  ),
                })}
            />
          </label>
          <label class="form-field form-field--compact"
            >W
            <input
              type="number"
              value={entry.width}
              oninput={(event) =>
                updateDraft(String(entry.instanceId), {
                  width: Math.max(
                    1,
                    Number(
                      (event.currentTarget as HTMLInputElement).value || 1,
                    ),
                  ),
                })}
            />
          </label>
          <label class="form-field form-field--compact"
            >H
            <input
              type="number"
              value={entry.height}
              oninput={(event) =>
                updateDraft(String(entry.instanceId), {
                  height: Math.max(
                    1,
                    Number(
                      (event.currentTarget as HTMLInputElement).value || 1,
                    ),
                  ),
                })}
            />
          </label>
        </div>
        <div class="form-actions">
          {#if canOperate}
            <button
              type="button"
              class="button-secondary"
              onclick={() => applyWindowUpdate(String(entry.instanceId))}
              >Apply</button
            >
          {/if}
        </div>
      </div>
    {:else}
      <EmptyState message="No widget windows in participant layout." />
    {/each}
  </div>
</SurfaceCard>

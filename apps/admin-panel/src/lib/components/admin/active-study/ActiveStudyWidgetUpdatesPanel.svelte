<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { SESSION_OPERATION_ACCESS_REQUIRED } from "$lib/permissions";

  let {
    canOperate = false,
    triggerableWidgets = [],
    selectedSession = "",
    widgetUpdates = [],
    widgetTitle,
  } = $props<{
    canOperate?: boolean;
    triggerableWidgets?: Array<Record<string, unknown>>;
    selectedSession?: string;
    widgetUpdates?: Array<Record<string, unknown>>;
    widgetTitle: (update: Record<string, unknown>) => string;
  }>();
</script>

<SurfaceCard
  title="Widget Updates"
  subtitle="Trigger widget actions manually during the session."
>
  <div class="pill-row">
    {#each triggerableWidgets as widget}
        <form method="POST" action="?/trigger">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <input type="hidden" name="instanceId" value={widget.instanceId} />
          <input type="hidden" name="widgetId" value={widget.widgetId} />
          <input type="hidden" name="action" value="manual-trigger" />
          <button class="button-chip" type="submit" disabled={!canOperate || !selectedSession} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>
            {widget.name}
          </button>
        </form>
    {/each}
  </div>
  <div class="list-stack">
    {#each widgetUpdates as update}
      <div class="entity-card entity-card--tight">
        <p class="entity-card__title">{widgetTitle(update)}</p>
        <p class="entity-card__meta">
          {update.action ?? update.triggerType ?? "binding update"}
        </p>
      </div>
    {:else}
      <EmptyState message="No widget updates have been received." />
    {/each}
  </div>
</SurfaceCard>

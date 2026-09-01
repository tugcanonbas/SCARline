<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { SESSION_OPERATION_ACCESS_REQUIRED } from '$lib/permissions';

  let {
    events = [], eventTitle, eventTime, selectedSession = '', selectedSessionDetail = null,
    canOperate = false, commandPending = false, liveLifecycle = null,
  } = $props<{
    events?: Array<Record<string, unknown>>;
    eventTitle: (event: Record<string, unknown>) => string;
    eventTime: (event: Record<string, unknown>) => string;
    selectedSession?: string; selectedSessionDetail?: Record<string, unknown> | null;
    canOperate?: boolean; commandPending?: boolean; liveLifecycle?: Record<string, unknown> | null;
  }>();
  const conditions = $derived((selectedSessionDetail?.conditions as Array<Record<string, unknown>> | undefined) ?? []);
  const activeCondition = $derived(selectedSessionDetail?.activeCondition as Record<string, unknown> | null | undefined);
  const nextCondition = $derived(selectedSessionDetail?.nextCondition as Record<string, unknown> | null | undefined);
  const activeConditionName = $derived(String(liveLifecycle?.activeConditionName ?? activeCondition?.name ?? 'Not started'));
  const activeSequence = $derived(Number(liveLifecycle?.activeConditionSequence ?? activeCondition?.sequence ?? -1));
  const conditionCount = $derived(Number(liveLifecycle?.conditionCount ?? selectedSessionDetail?.conditionCount ?? conditions.length));
  const remainingCount = $derived(Number(liveLifecycle?.remainingConditionCount ?? selectedSessionDetail?.remainingConditionCount ?? conditions.length));
</script>

<SurfaceCard title="Session Events" subtitle="Condition lifecycle and simulator events for the selected session.">
  {#if selectedSessionDetail}
    <div class="detail-panel detail-panel--soft mb-4">
      <div class="toolbar">
        <div><p class="kv-label">Active condition</p><p class="kv-value">{activeConditionName}</p></div>
        {#if activeSequence >= 0 && conditionCount > 0}<span class="entity-card__meta">{activeSequence + 1} of {conditionCount}</span>{/if}
      </div>
      <p>Remaining conditions: <strong>{remainingCount}</strong></p>
      {#if nextCondition}<p>Next: <strong>{String(nextCondition.name ?? 'Next condition')}</strong></p>{/if}
      <div class="entity-list mt-3">
        {#each conditions as condition}
          <div class="entity-card entity-card--compact"><div class="toolbar"><span>{String(condition.name ?? 'Condition')}</span><StatusBadge status={String(condition.status ?? 'pending')} /></div></div>
        {/each}
      </div>
      {#if nextCondition && String(selectedSessionDetail.status) === 'running'}
        <form method="POST" action="?/advance" class="mt-3">
          <input type="hidden" name="sessionId" value={selectedSession} />
          <button class="button-secondary button-block" type="submit" disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>Advance to {String(nextCondition.name ?? 'Next Condition')}</button>
        </form>
      {/if}
    </div>
  {/if}
  <div class="timeline-list">
    {#each events as event}
      <div class="timeline-entry text-sm">
        <div class="toolbar"><p class="font-semibold">{eventTitle(event)}</p><span class="entity-card__meta">{eventTime(event)}</span></div>
        <p class="entity-card__meta">Session {event.sessionId ?? selectedSession ?? 'unknown'}</p>
      </div>
    {:else}
      <EmptyState message="Waiting for session lifecycle events." />
    {/each}
  </div>
</SurfaceCard>

<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate, shortId } from "$lib/format";
  import { appPath } from "$lib/paths";
  import { SESSION_OPERATION_ACCESS_REQUIRED } from "$lib/permissions";
  import { Trash2 } from "lucide-svelte";

  let { data, form } = $props();

  let selectedConditionIds = $state<string[]>([]);

  function handleConditionSelection(conditionId: string, selected: boolean) {
    selectedConditionIds = selected
      ? [...selectedConditionIds, conditionId]
      : selectedConditionIds.filter((id) => id !== conditionId);
  }

  function handleMoveCondition(conditionId: string, direction: -1 | 1) {
    const index = selectedConditionIds.indexOf(conditionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selectedConditionIds.length) return;
    const next = [...selectedConditionIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    selectedConditionIds = next;
  }

  function conditionName(conditionId: string) {
    return data.conditions.find((condition: Record<string, unknown>) => condition.id === conditionId)?.name ?? shortId(conditionId);
  }

  const runningCount = $derived(
    data.sessions.filter(
      (session: Record<string, unknown>) => session.status === "running",
    ).length,
  );
  const completedCount = $derived(
    data.sessions.filter(
      (session: Record<string, unknown>) => session.status === "completed",
    ).length,
  );
</script>

<PageHeader
  eyebrow="Study"
  title="Sessions"
  description="Create and queue study sessions for operation in Active Study."
/>
<StudyTabs
  studyId={data.studyId}
  current={`/user-studies/${data.studyId}/sessions`}
/>

<div class="metric-grid">
  <MetricCard
    label="Sessions"
    value={data.sessions.length}
    hint="Created session records"
    accent
  />
  <MetricCard
    label="Running"
    value={runningCount}
    hint="Live operator workload"
  />
  <MetricCard
    label="Completed"
    value={completedCount}
    hint="Ready for log review/export"
  />
  <MetricCard
    label="Setup Inputs"
    value={`${data.participants.length}/${data.conditions.length}`}
    hint="Participants and conditions available"
  />
</div>

<div class="section-grid section-grid--sidebar mt-4">
  <SurfaceCard
      title="Create Session"
      subtitle="Bind a participant and one or more ordered conditions before queueing the session."
    >
      {#if form?.message}
        <InlineNotice tone="danger" message={form.message} />
      {/if}

      <form method="POST" action="?/create">
        <fieldset class="form-stack" disabled={!data.canOperate} title={!data.canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>
        <label class="form-field">
          <span>Name</span>
          <input name="name" placeholder="Session 1" />
        </label>
        <label class="form-field">
          <span>Participant</span>
          <select name="participantId">
            <option value="">Unassigned</option>
            {#each data.participants as participant}
              <option value={participant.id}
                >{participant.participantCode}</option
              >
            {/each}
          </select>
        </label>
        <div class="form-field">
          <span>Conditions</span>
          <div class="list-stack">
            {#each data.conditions as condition}
              <label class="entity-card entity-card--tight">
                <input
                  type="checkbox"
                  checked={selectedConditionIds.includes(String(condition.id))}
                  onchange={(event) => handleConditionSelection(String(condition.id), event.currentTarget.checked)}
                />
                <span>{condition.name}</span>
              </label>
            {/each}
          </div>
        </div>
        {#if selectedConditionIds.length > 0}
          <div class="form-field">
            <span>Condition Order</span>
            <div class="list-stack">
              {#each selectedConditionIds as conditionId, index}
                <div class="entity-card entity-card--tight">
                  <input type="hidden" name="conditionIds" value={conditionId} />
                  <div class="toolbar">
                    <span>{index + 1}. {conditionName(conditionId)}</span>
                    <div class="action-strip">
                      <button class="button-chip" type="button" disabled={index === 0} onclick={() => handleMoveCondition(conditionId, -1)}>Move Up</button>
                      <button class="button-chip" type="button" disabled={index === selectedConditionIds.length - 1} onclick={() => handleMoveCondition(conditionId, 1)}>Move Down</button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="form-actions">
          <button class="button-primary" type="submit" title={!data.canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>Create Session</button>
        </div>
        </fieldset>
      </form>
  </SurfaceCard>

  <SurfaceCard
    title="Session Queue"
    subtitle="Review queued sessions and open Active Study to operate them."
  >
    <div class="list-stack">
      {#each data.sessions as session}
        <div class="entity-card" style="position: relative;">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">
                {session.name ?? `Session ${shortId(session.id as string)}`}
              </p>
              <p class="entity-card__meta">
                Participant {session.participantId
                  ? shortId(session.participantId as string)
                  : "unassigned"} · {session.conditionCount ?? 0} condition{session.conditionCount === 1 ? "" : "s"}
              </p>
            </div>
            <StatusBadge status={session.status} />
          </div>

          <div class="detail-grid-3">
            <div class="detail-panel">
              <p class="technical-label">Started</p>
              <p class="technical-value">{formatDate(session.startedAt)}</p>
            </div>
            <div class="detail-panel">
              <p class="technical-label">Duration</p>
              <p class="technical-value">{session.durationSeconds ?? 0}s</p>
            </div>
            <div class="detail-panel">
              <p class="technical-label">Completed</p>
              <p class="technical-value">{formatDate(session.completedAt)}</p>
            </div>
          </div>

          <div class="session-card-footer">
            <div class="form-actions">
              <a class="button-secondary" href={appPath(`/user-studies/${data.studyId}/active-study?sessionId=${session.id}`)}>Open Active Study</a>
            </div>
            {#if data.canOperate}
              <form method="POST" action="?/delete"
                onsubmit={(e) => { if (!confirm(`Delete session "${session.name ?? session.id}"? This cannot be undone.`)) e.preventDefault(); }}>
                <input name="sessionId" type="hidden" value={session.id} />
                <button
                  class="button-icon-danger"
                  type="submit"
                  title="Delete session"
                  aria-label="Delete session"
                ><Trash2 size={16} /></button>
              </form>
            {/if}
          </div>
        </div>
      {:else}
        <EmptyState message="No sessions have been created yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

<style>
  .session-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.75rem;
    gap: 0.5rem;
  }

  .button-icon-danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.375rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-danger, #ef4444);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }

  .button-icon-danger:hover {
    background: color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-danger, #ef4444) 40%, transparent);
  }
</style>

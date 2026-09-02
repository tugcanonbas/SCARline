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
  import { ChevronUp, ChevronDown } from "lucide-svelte";

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
    if (index < 0 || target < 0 || target >= selectedConditionIds.length)
      return;
    const next = [...selectedConditionIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    selectedConditionIds = next;
  }

  const orderedConditions = $derived([
    ...selectedConditionIds.map((id) =>
      data.conditions.find(
        (condition: Record<string, unknown>) => String(condition.id) === id,
      ),
    ),
    ...data.conditions.filter(
      (condition: Record<string, unknown>) =>
        !selectedConditionIds.includes(String(condition.id)),
    ),
  ].filter(Boolean) as Record<string, unknown>[]);

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
      <fieldset
        class="form-stack"
        disabled={!data.canOperate}
        title={!data.canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}
      >
        <label class="form-field required">
          <span>Name</span>
          <input name="name" placeholder="Session 1" required />
        </label>
        <label class="form-field required">
          <span>Participant</span>
          <select name="participantId" required>
            <option value="">Unassigned</option>
            {#each data.participants as participant}
              <option value={participant.id}
                >{participant.participantCode}</option
              >
            {/each}
          </select>
        </label>
        
        <!-- Conditions field: select and order in one list -->
        <div class="form-field required">
          <span>Conditions</span>
          <div class="list-stack list-stack--tight">
            {#each orderedConditions as condition (condition.id)}
              {@const conditionId = String(condition.id)}
              {@const index = selectedConditionIds.indexOf(conditionId)}
              {@const selected = index !== -1}
              <div class="condition-row toolbar">
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onchange={(event) =>
                      handleConditionSelection(
                        conditionId,
                        event.currentTarget.checked,
                      )}
                  />
                  <span
                    >{selected ? `${index + 1}. ` : ""}{condition.name}</span
                  >
                </label>
                {#if selected}
                  <input type="hidden" name="conditionIds" value={conditionId} />
                  <div class="action-strip">
                    <button
                      class="button-chip"
                      type="button"
                      disabled={index === 0}
                      onclick={() => handleMoveCondition(conditionId, -1)}
                      ><ChevronUp size={16} /></button
                    >
                    <button
                      class="button-chip"
                      type="button"
                      disabled={index === selectedConditionIds.length - 1}
                      onclick={() => handleMoveCondition(conditionId, 1)}
                      ><ChevronDown size={16} /></button
                    >
                  </div>
                {/if}
              </div>
            {:else}
              <p class="text-sm opacity-60">No conditions available.</p>
            {/each}
          </div>
        </div>
        <div class="form-actions">
          <button
            class="button-primary"
            type="submit"
            title={!data.canOperate
              ? SESSION_OPERATION_ACCESS_REQUIRED
              : undefined}>Create Session</button
          >
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
        <div class="entity-card">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">
                {session.name ?? `Session ${shortId(session.id as string)}`}
              </p>
              <p class="entity-card__meta">
                Participant {session.participantId
                  ? shortId(session.participantId as string)
                  : "unassigned"} · {session.conditionCount ?? 0} condition{session.conditionCount ===
                1
                  ? ""
                  : "s"}
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

          <div class="form-actions">
            <a
              class="button-secondary"
              href={appPath(
                `/user-studies/${data.studyId}/active-study?sessionId=${session.id}`,
              )}>Open Active Study</a
            >
          </div>
        </div>
      {:else}
        <EmptyState message="No sessions have been created yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

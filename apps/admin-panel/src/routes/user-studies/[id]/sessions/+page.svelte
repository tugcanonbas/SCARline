<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate, formatStatusLabel, shortId } from "$lib/format";

  let { data, form } = $props();

  const allowedTransitions: Record<string, string[]> = {
    created: ["start"],
    running: ["pause", "complete", "cancel"],
    paused: ["resume", "cancel"],
    completed: [],
    cancelled: [],
  };

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
  description="Create sessions and manage their lifecycle."
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
  {#if data.canOperate}
    <SurfaceCard
      title="Create Session"
      subtitle="Bind a participant and optional condition before starting the session."
    >
      {#if form?.message}
        <InlineNotice tone="danger" message={form.message} />
      {/if}

      <form class="form-stack" method="POST" action="?/create">
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
        <label class="form-field">
          <span>Condition</span>
          <select name="conditionId">
            <option value="">None</option>
            {#each data.conditions as condition}
              <option value={condition.id}>{condition.name}</option>
            {/each}
          </select>
        </label>
        <div class="form-actions">
          <button class="button-primary" type="submit">Create Session</button>
        </div>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard
    title="Session Queue"
    subtitle="Manage and transition the states of your study sessions."
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
                  : "unassigned"} · Condition {session.conditionId
                  ? shortId(session.conditionId as string)
                  : "none"}
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

          {#if data.canOperate}
            {@const validActions =
              allowedTransitions[session.status as string] ?? []}
            {#if validActions.length > 0}
              <div class="form-actions">
                {#each validActions as actionName}
                  {#if actionName === "cancel"}
                    <form method="POST" action="?/cancel">
                      <input
                        name="sessionId"
                        type="hidden"
                        value={session.id}
                      />
                      <input
                        name="reason"
                        type="hidden"
                        value="Operator cancelled session"
                      />
                      <button class="button-danger" type="submit"
                        >{formatStatusLabel(actionName)}</button
                      >
                    </form>
                  {:else}
                    <form method="POST" action={`?/${actionName}`}>
                      <input
                        name="sessionId"
                        type="hidden"
                        value={session.id}
                      />
                      <button class="button-chip" type="submit"
                        >{formatStatusLabel(actionName)}</button
                      >
                    </form>
                  {/if}
                {/each}
              </div>
            {:else}
              <p class="entity-card__meta mt-2">
                No further actions — this session has reached its final state.
              </p>
            {/if}
          {/if}
        </div>
      {:else}
        <EmptyState message="No sessions have been created yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

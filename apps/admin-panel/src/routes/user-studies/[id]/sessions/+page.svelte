<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data, form } = $props();

  const allowedTransitions: Record<string, string[]> = {
    created: ['start'],
    running: ['pause', 'complete', 'cancel'],
    paused: ['resume', 'cancel'],
    completed: [],
    cancelled: []
  };

  function canTransition(status: string, actionName: string) {
    return allowedTransitions[status]?.includes(actionName) ?? false;
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return 'Not recorded';
    return new Date(value).toLocaleString();
  }

  const runningCount = $derived(data.sessions.filter((session) => session.status === 'running').length);
  const completedCount = $derived(data.sessions.filter((session) => session.status === 'completed').length);
</script>

<PageHeader eyebrow="Study" title="Sessions" description="Create sessions and drive lifecycle transitions through the CoreAPI command path." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/sessions`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Sessions</p>
    <p class="metric-card__value">{data.sessions.length}</p>
    <p class="metric-card__hint">Created session records</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Running</p>
    <p class="metric-card__value">{runningCount}</p>
    <p class="metric-card__hint">Live operator workload</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Completed</p>
    <p class="metric-card__value">{completedCount}</p>
    <p class="metric-card__hint">Ready for log review/export</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Setup Inputs</p>
    <p class="metric-card__value">{data.participants.length}/{data.conditions.length}</p>
    <p class="metric-card__hint">Participants and conditions available</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Create Session" subtitle="Bind a participant and optional condition before starting the session.">
    {#if form?.message}
      <p class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">
        {form.message}
      </p>
    {/if}

    <form class="grid gap-4" method="POST" action="?/create">
      <label class="grid gap-2 text-sm">
        <span>Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" placeholder="Session 1" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Participant</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="participantId">
          <option value="">Unassigned</option>
          {#each data.participants as participant}
            <option value={participant.id}>{participant.participantCode}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Condition</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="conditionId">
          <option value="">None</option>
          {#each data.conditions as condition}
            <option value={condition.id}>{condition.name}</option>
          {/each}
        </select>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Create Session</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Session Queue" subtitle="State transitions use existing SvelteKit form actions and CoreAPI commands.">
    <div class="space-y-3">
      {#each data.sessions as session}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{session.name ?? session.id}</p>
              <p class="text-sm text-slate-400">
                Participant {session.participantId ?? session.participant_id ?? 'unassigned'} · Condition {session.conditionId ?? session.condition_id ?? 'none'}
              </p>
            </div>
            <StatusBadge status={session.status} />
          </div>

          <div class="mb-4 grid gap-3 md:grid-cols-3">
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Started</p>
              <p class="mt-1 text-slate-100">{formatDate(session.startedAt ?? session.started_at)}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Duration</p>
              <p class="mt-1 text-slate-100">{session.durationSeconds ?? session.duration_seconds ?? 0}s</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Completed</p>
              <p class="mt-1 text-slate-100">{formatDate(session.completedAt ?? session.completed_at)}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            {#each ['start', 'pause', 'resume', 'complete'] as actionName}
              <form method="POST" action={`?/${actionName}`}>
                <input name="sessionId" type="hidden" value={session.id} />
                <button
                  class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
                  type="submit"
                  disabled={!canTransition(session.status, actionName)}
                >{actionName}</button>
              </form>
            {/each}
            <form method="POST" action="?/cancel">
              <input name="sessionId" type="hidden" value={session.id} />
              <input name="reason" type="hidden" value="Operator cancelled session" />
              <button
                class="rounded-full border border-[--color-danger]/40 px-3 py-1 text-xs text-red-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
                type="submit"
                disabled={!canTransition(session.status, 'cancel')}
              >cancel</button>
            </form>
          </div>
       </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No sessions have been created yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

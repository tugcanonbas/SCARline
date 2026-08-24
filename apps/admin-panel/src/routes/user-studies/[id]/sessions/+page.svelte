<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { Trash2 } from 'lucide-svelte';

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

  const runningCount = $derived(data.sessions.filter((session: Record<string, unknown>) => session.status === 'running').length);
  const completedCount = $derived(data.sessions.filter((session: Record<string, unknown>) => session.status === 'completed').length);
</script>

<PageHeader eyebrow="Study" title="Sessions" description="Create sessions and drive lifecycle transitions through the CoreAPI command path." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/sessions`} />

<div class="metric-grid">
  <MetricCard label="Sessions" value={data.sessions.length} hint="Created session records" accent />
  <MetricCard label="Running" value={runningCount} hint="Live operator workload" />
  <MetricCard label="Completed" value={completedCount} hint="Ready for log review/export" />
  <MetricCard label="Setup Inputs" value={`${data.participants.length}/${data.conditions.length}`} hint="Participants and conditions available" />
</div>

<div class="section-grid section-grid--sidebar">
  {#if data.canOperate}
    <SurfaceCard title="Create Session" subtitle="Bind a participant and optional condition before starting the session.">
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
              <option value={participant.id}>{participant.participantCode}</option>
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

  <SurfaceCard title="Session Queue" subtitle="State transitions use existing SvelteKit form actions and CoreAPI commands.">
    <div class="list-stack">
      {#each data.sessions as session}
        <div class="entity-card" style="position: relative;">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">{session.name ?? session.id}</p>
              <p class="entity-card__meta">
                Participant {session.participantId ?? 'unassigned'} · Condition {session.conditionId ?? 'none'}
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
          <div class="session-card-footer">
            <div class="form-actions">
              {#each ['start', 'pause', 'resume', 'complete'] as actionName}
                <form method="POST" action={`?/${actionName}`}>
                  <input name="sessionId" type="hidden" value={session.id} />
                  <button
                    class="button-chip"
                    type="submit"
                    disabled={!canTransition(session.status, actionName)}
                  >{actionName}</button>
                </form>
              {/each}
            </div>
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
          </div>
          {/if}
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

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  function participantCode(participant: Record<string, unknown>) {
    return String(participant.participantCode ?? participant.participant_code ?? participant.id);
  }

  function participantNotes(participant: Record<string, unknown>) {
    return String(participant.notes ?? 'No notes recorded');
  }

  function participantCreated(participant: Record<string, unknown>) {
    return String(participant.createdAt ?? participant.created_at ?? 'Not recorded');
  }
</script>

<PageHeader eyebrow="Study" title="Participants" description="Create anonymized participant records and attach operator notes." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participants`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Participant Records</p>
    <p class="metric-card__value">{data.participants.length}</p>
    <p class="metric-card__hint">Anonymized IDs ready for sessions</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Coding Pattern</p>
    <p class="metric-card__value">P-###</p>
    <p class="metric-card__hint">Recommended local identifier format</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Notes</p>
    <p class="metric-card__value">{data.participants.filter((participant: Record<string, unknown>) => participant.notes).length}</p>
    <p class="metric-card__hint">Records with operator notes</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Privacy</p>
    <p class="metric-card__value">ID</p>
    <p class="metric-card__hint">No direct personal identifiers shown here</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Add Participant" subtitle="Create the participant record used by session setup.">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Participant Code</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="participantCode" placeholder="P-001" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Notes</span>
        <textarea class="min-h-32 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="notes"></textarea>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Add Participant</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Current Participants" subtitle="Use these records when creating or reviewing sessions.">
    <div class="space-y-3">
      {#each data.participants as participant}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{participantCode(participant)}</p>
              <p class="mt-1 text-sm text-slate-400">{participantNotes(participant)}</p>
            </div>
            <div class="text-left md:text-right">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Participant</p>
              <p class="mt-1 text-xs text-slate-500">{participantCreated(participant)}</p>
            </div>
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No participants have been added yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

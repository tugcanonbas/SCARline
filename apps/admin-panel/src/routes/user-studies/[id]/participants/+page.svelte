<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { formatDate, shortId } from '$lib/format';

  let { data } = $props();

  function participantCode(participant: Record<string, unknown>) {
    const code = participant.participantCode ?? participant.participant_code;
    if (code) return String(code);
    return `No code (${shortId(participant.id as string)})`;
  }

  function participantNotes(participant: Record<string, unknown>) {
    return String(participant.notes ?? 'No notes recorded');
  }

  function participantCreated(participant: Record<string, unknown>) {
    return formatDate(
      (participant.createdAt ?? participant.created_at) as string | undefined,
    );
  }
</script>

<PageHeader eyebrow="Study" title="Participants" description="Create anonymized participant records and attach operator notes." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participants`} />

<div class="metric-grid">
  <MetricCard label="Participant Records" value={data.participants.length} hint="Anonymized IDs ready for sessions" accent />
  <MetricCard label="Coding Pattern" value="P-###" hint="Recommended local identifier format" />
  <MetricCard label="Notes" value={data.participants.filter((participant: Record<string, unknown>) => participant.notes).length} hint="Records with operator notes" />
  <MetricCard label="Privacy" value="ID" hint="No direct personal identifiers shown here" />
</div>

<div class="section-grid section-grid--sidebar">
  {#if data.canManage}
    <SurfaceCard title="Add Participant" subtitle="Create the participant record used by session setup.">
      <form class="form-stack" method="POST">
        <label class="form-field">
          <span>Participant Code</span>
          <input name="participantCode" placeholder="P-001" required />
        </label>
        <label class="form-field">
          <span>Notes</span>
          <textarea class="min-h-32" name="notes"></textarea>
        </label>
        <div class="form-actions">
          <button class="button-primary" type="submit">Add Participant</button>
        </div>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard title="Current Participants" subtitle="Use these records when creating or reviewing sessions.">
    <div class="list-stack">
      {#each data.participants as participant}
        <div class="entity-card entity-card--tight">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">{participantCode(participant)}</p>
              <p class="entity-card__meta">{participantNotes(participant)}</p>
            </div>
            <div class="entity-card__meta">
              <p>Participant</p>
              <p>{participantCreated(participant)}</p>
            </div>
          </div>
        </div>
      {:else}
        <EmptyState message="No participants have been added yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

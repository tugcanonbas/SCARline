<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title="Participants" description="Create anonymized participant records and attach operator notes." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participants`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Add Participant">
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

  <SurfaceCard title="Current Participants">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.participants, null, 2)}</pre>
  </SurfaceCard>
</div>

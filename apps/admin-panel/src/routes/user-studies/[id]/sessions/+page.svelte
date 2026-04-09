<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title="Sessions" description="Create sessions and drive lifecycle transitions through the CoreAPI command path." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/sessions`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Create Session">
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

  <SurfaceCard title="Session Queue">
    <div class="space-y-3">
      {#each data.sessions as session}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <p class="font-semibold text-white">{session.name ?? session.id}</p>
              <p class="text-sm text-slate-400">{session.status}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              {#each ['start', 'pause', 'resume', 'complete'] as actionName}
                <form method="POST" action={`?/${actionName}`}>
                  <input name="sessionId" type="hidden" value={session.id} />
                  <button class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-200" type="submit">{actionName}</button>
                </form>
              {/each}
              <form method="POST" action="?/cancel">
                <input name="sessionId" type="hidden" value={session.id} />
                <input name="reason" type="hidden" value="Operator cancelled session" />
                <button class="rounded-full border border-[--color-danger]/40 px-3 py-1 text-xs text-red-200" type="submit">cancel</button>
              </form>
            </div>
          </div>
          <pre class="overflow-auto rounded-2xl bg-black/30 p-3 text-xs text-slate-300">{JSON.stringify(session, null, 2)}</pre>
        </div>
      {/each}
    </div>
  </SurfaceCard>
</div>

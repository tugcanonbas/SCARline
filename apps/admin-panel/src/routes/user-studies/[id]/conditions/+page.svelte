<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title="Conditions" description="Model milestone-1 weather and widget overrides for controlled session variants." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/conditions`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Add Condition">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Description</span>
        <textarea class="min-h-28 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="description"></textarea>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Weather Override</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="weather" placeholder="HardRainNoon" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Hidden Widgets (comma separated)</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="hiddenWidgets" placeholder="music,calendar" />
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Condition</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Condition Set">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.conditions, null, 2)}</pre>
  </SurfaceCard>
</div>

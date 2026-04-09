<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title="Participant View" description="Build the first overlay layout with a single display zone and a constrained widget catalogue." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participant-view`} />

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Layout Builder">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Layout Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" value="Primary Participant Layout" />
      </label>
      <fieldset class="grid gap-3">
        <legend class="text-sm font-semibold text-white">Widgets</legend>
        {#each data.widgets as widget}
          <label class="flex items-center gap-3 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
            <input class="size-4" name="widgetIds" type="checkbox" value={widget.id} />
            <span>{widget.name}</span>
            <span class="ml-auto text-xs uppercase tracking-[0.18em] text-slate-500">{widget.category}</span>
          </label>
        {/each}
      </fieldset>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Layout</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Current Layout Records">
    <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.layouts, null, 2)}</pre>
  </SurfaceCard>
</div>

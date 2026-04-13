<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  function layoutConfig(layout: Record<string, unknown>) {
    return (layout.layoutConfig ?? layout.layout_config ?? {}) as Record<string, unknown>;
  }

  function zones(layout: Record<string, unknown>) {
    const config = layoutConfig(layout);
    return Array.isArray(config.zones) ? config.zones : [];
  }

  function widgets(layout: Record<string, unknown>) {
    const config = layoutConfig(layout);
    return Array.isArray(config.widgets) ? config.widgets : [];
  }

  const savedWidgetCount = $derived(
    data.layouts.reduce((count: number, layout: Record<string, unknown>) => count + widgets(layout).length, 0)
  );
</script>

<PageHeader eyebrow="Study" title="Participant View" description="Build the first overlay layout with a single display zone and a constrained widget catalogue." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participant-view`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Layouts</p>
    <p class="metric-card__value">{data.layouts.length}</p>
    <p class="metric-card__hint">Saved participant-view records</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Catalogue</p>
    <p class="metric-card__value">{data.widgets.length}</p>
    <p class="metric-card__hint">Static widgets available to the layout</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Placed Widgets</p>
    <p class="metric-card__value">{savedWidgetCount}</p>
    <p class="metric-card__hint">Widget instances in saved layouts</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Display Scope</p>
    <p class="metric-card__value">1</p>
    <p class="metric-card__hint">Milestone layout target display</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Layout Builder" subtitle="Select widgets using the current server action; the preview reflects saved layout records.">
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

  <SurfaceCard title="Current Layout Records" subtitle="Saved overlay layouts and a static authoring preview.">
    <div class="canvas-preview mb-4">
      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="technical-label">Participant display preview</p>
        <span class="status-badge status-badge--soft">Single zone</span>
      </div>
      {#if data.layouts[0]}
        {#each widgets(data.layouts[0]) as widget, index}
          <div class="canvas-widget mb-2 inline-block mr-2">
            {widget.widgetId ?? widget.id ?? `Widget ${index + 1}`}
          </div>
        {/each}
      {:else}
        <p class="technical-value">Save a layout to populate this preview with selected widgets.</p>
      {/if}
    </div>
    <div class="space-y-3">
      {#each data.layouts as layout}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{layout.name}</p>
              <p class="mt-1 text-sm text-slate-400">{layout.type} layout · display {layout.targetDisplay ?? layout.target_display ?? '0'}</p>
            </div>
            <span class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300">{widgets(layout).length} widgets</span>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Zones</p>
              <p class="mt-1 text-slate-100">{zones(layout).map((zone) => zone.id).join(', ') || 'None'}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Widgets</p>
              <p class="mt-1 text-slate-100">{widgets(layout).map((widget) => widget.widgetId).join(', ') || 'None'}</p>
            </div>
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No participant layout has been saved yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

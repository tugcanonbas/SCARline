<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  function weather(condition: Record<string, unknown>) {
    const overrides = (condition.carlaOverrides ?? condition.carla_overrides ?? {}) as Record<string, unknown>;
    return overrides.weather ?? 'Default study weather';
  }

  function hiddenWidgets(condition: Record<string, unknown>) {
    const overrides = (condition.widgetOverrides ?? condition.widget_overrides ?? {}) as Record<string, unknown>;
    const hidden = overrides.hidden_widgets;
    return Array.isArray(hidden) && hidden.length ? hidden.join(', ') : 'None';
  }

  function ruleSummary(condition: Record<string, unknown>) {
    const overrides = (condition.widgetOverrides ?? condition.widget_overrides ?? {}) as Record<string, unknown>;
    const hidden = overrides.hidden_widgets;
    const hiddenCount = Array.isArray(hidden) ? hidden.length : 0;
    return hiddenCount ? `${hiddenCount} hidden widget override${hiddenCount === 1 ? '' : 's'}` : 'No widget overrides';
  }
</script>

<PageHeader eyebrow="Study" title="Conditions" description="Model milestone-1 weather and widget overrides for controlled session variants." />
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/conditions`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Condition Variants</p>
    <p class="metric-card__value">{data.conditions.length}</p>
    <p class="metric-card__hint">Available during session setup</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Weather Overrides</p>
    <p class="metric-card__value">{data.conditions.filter((condition) => weather(condition) !== 'Default study weather').length}</p>
    <p class="metric-card__hint">Conditions changing simulator weather</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Widget Overrides</p>
    <p class="metric-card__value">{data.conditions.filter((condition) => hiddenWidgets(condition) !== 'None').length}</p>
    <p class="metric-card__hint">Conditions changing participant view</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Ordering</p>
    <p class="metric-card__value">Manual</p>
    <p class="metric-card__hint">Use order metadata for run planning</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
  <SurfaceCard title="Add Condition" subtitle="Capture the condition metadata supported by the existing CoreAPI action.">
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

  <SurfaceCard title="Condition Set" subtitle="Operational summary of condition-specific simulator and widget behavior.">
    <div class="space-y-3">
      {#each data.conditions as condition}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <div class="mb-3 flex items-start justify-between gap-4">
            <div>
              <p class="font-semibold text-white">{condition.name}</p>
              <p class="mt-1 text-sm text-slate-400">{condition.description ?? 'No description'}</p>
            </div>
            <span class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300">Order {condition.order ?? 0}</span>
          </div>
          <div class="mb-3 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Rule Builder Coverage</p>
            <p class="mt-1 text-slate-100">{ruleSummary(condition)}</p>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Weather</p>
              <p class="mt-1 text-slate-100">{weather(condition)}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Hidden Widgets</p>
              <p class="mt-1 text-slate-100">{hiddenWidgets(condition)}</p>
            </div>
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No conditions have been defined yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { enhance } from '$app/forms';

  let { data } = $props();

  type TriggerRule = {
    ruleName: string;
    widgetId: string;
    condition: string;
    action: 'show' | 'hide' | 'highlight' | 'update' | 'reset';
    bindingOverrides: Record<string, string>;
  };

  type Condition = {
    id: string;
    name: string;
    description?: string | null;
    order: number;
    carlaOverrides: Record<string, unknown>;
    widgetOverrides: Record<string, unknown>;
  };

  // ─── Weather presets ──────────────────────────────────────────────────────────
  const weatherPresets = [
    'ClearNoon', 'ClearSunset', 'CloudyNoon', 'CloudySunset',
    'WetNoon', 'WetSunset', 'HardRainNoon', 'HardRainSunset',
    'SoftRainNoon', 'SoftRainSunset', 'MidRainSunset', 'MidRainyNoon'
  ];
  const triggerActions = ['show', 'hide', 'highlight', 'update', 'reset'];

  // ─── State for new condition form ─────────────────────────────────────────────
  let newName = $state('');
  let newDescription = $state('');
  let newWeather = $state('');
  let newHiddenWidgets = $state('');
  let newRules = $state<TriggerRule[]>([]);

  // ─── State for inline editing ─────────────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editRules = $state<TriggerRule[]>([]);

  function getCarlaOverrides(c: Record<string, unknown>) {
    return (c.carlaOverrides ?? c.carla_overrides ?? {}) as Record<string, unknown>;
  }
  function getWidgetOverrides(c: Record<string, unknown>) {
    return (c.widgetOverrides ?? c.widget_overrides ?? {}) as Record<string, unknown>;
  }
  function getHiddenWidgets(c: Record<string, unknown>): string[] {
    const ov = getWidgetOverrides(c);
    return Array.isArray(ov.hidden_widgets) ? ov.hidden_widgets as string[] : [];
  }
  function getTriggerRules(c: Record<string, unknown>): TriggerRule[] {
    const ov = getWidgetOverrides(c);
    return Array.isArray(ov.triggerRules) ? ov.triggerRules as TriggerRule[] : [];
  }

  function addRule(targetRules: TriggerRule[], setRules: (r: TriggerRule[]) => void) {
    setRules([...targetRules, { ruleName: '', widgetId: '', condition: '', action: 'show', bindingOverrides: {} }]);
  }
  function removeRule(targetRules: TriggerRule[], idx: number, setRules: (r: TriggerRule[]) => void) {
    setRules(targetRules.filter((_, i) => i !== idx));
  }

  function startEdit(condition: Record<string, unknown>) {
    editingId = String(condition.id);
    editRules = [...getTriggerRules(condition)];
  }
  function cancelEdit() {
    editingId = null;
    editRules = [];
  }

  const weatherCount = $derived(
    (data.conditions as Record<string, unknown>[]).filter((c) => getCarlaOverrides(c).weather).length
  );
  const widgetOverrideCount = $derived(
    (data.conditions as Record<string, unknown>[]).filter((c) => getHiddenWidgets(c).length > 0).length
  );
  const ruleCount = $derived(
    (data.conditions as Record<string, unknown>[]).reduce((sum, c) => sum + getTriggerRules(c).length, 0)
  );
</script>

<PageHeader
  eyebrow="Study"
  title="Conditions"
  description="Define experimental variants with CARLA overrides, hidden widgets, and configurable trigger rules."
/>
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/conditions`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Conditions</p>
    <p class="metric-card__value">{data.conditions.length}</p>
    <p class="metric-card__hint">Defined study variants</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Weather Overrides</p>
    <p class="metric-card__value">{weatherCount}</p>
    <p class="metric-card__hint">Conditions changing CARLA weather</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Widget Overrides</p>
    <p class="metric-card__value">{widgetOverrideCount}</p>
    <p class="metric-card__hint">Conditions hiding widgets</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Trigger Rules</p>
    <p class="metric-card__value">{ruleCount}</p>
    <p class="metric-card__hint">Auto-trigger conditions across all variants</p>
  </div>
</div>

<div class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr] mt-4">
  <!-- ── Add Condition ──────────────────────────────────────────────────── -->
  {#if data.canManage}
  <SurfaceCard title="Add Condition" subtitle="Define a new study condition variant with CARLA, widget, and trigger rule configuration.">
    <form class="grid gap-4" method="POST" action="?/create" use:enhance>
      <label class="grid gap-2 text-sm">
        <span>Name <span class="text-red-400">*</span></span>
        <input
          bind:value={newName}
          class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
          name="name"
          required
        />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Description</span>
        <textarea
          bind:value={newDescription}
          class="min-h-20 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
          name="description"
        ></textarea>
      </label>

      <!-- CARLA overrides -->
      <div class="condition-section">
        <p class="condition-section__title">CARLA Overrides</p>
        <label class="grid gap-2 text-sm">
          <span>Weather Preset</span>
          <select
            bind:value={newWeather}
            class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
            name="weather"
          >
            <option value="">Default (study config)</option>
            {#each weatherPresets as preset}
              <option value={preset}>{preset}</option>
            {/each}
          </select>
        </label>
      </div>

      <!-- Widget overrides -->
      <div class="condition-section">
        <p class="condition-section__title">Widget Overrides</p>
        <label class="grid gap-2 text-sm">
          <span>Hidden Widgets <span class="text-slate-500 font-normal">(comma-separated IDs)</span></span>
          <input
            bind:value={newHiddenWidgets}
            class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3"
            name="hiddenWidgets"
            placeholder="music,calendar,navigation-prompt"
          />
        </label>
      </div>

      <!-- Trigger rules builder -->
      <div class="condition-section">
        <div class="condition-section__row">
          <p class="condition-section__title">Trigger Rules</p>
          <button
            class="condition-add-rule-btn"
            onclick={() => addRule(newRules, (r) => (newRules = r))}
            type="button"
          >+ Add Rule</button>
        </div>
        {#each newRules as rule, i}
          <div class="trigger-rule-row">
            <input type="hidden" name="rules" value={JSON.stringify(rule)} />
            <input
              bind:value={rule.ruleName}
              class="trigger-input"
              placeholder="Rule name"
              type="text"
            />
            <input
              bind:value={rule.widgetId}
              class="trigger-input"
              placeholder="Widget ID"
              type="text"
            />
            <input
              bind:value={rule.condition}
              class="trigger-input trigger-input--wide"
              placeholder="e.g. vehicle.speed > vehicle.speedLimit"
              type="text"
            />
            <select bind:value={rule.action} class="trigger-select">
              {#each triggerActions as action}
                <option value={action}>{action}</option>
              {/each}
            </select>
            <button
              class="trigger-remove-btn"
              onclick={() => removeRule(newRules, i, (r) => (newRules = r))}
              type="button"
            >×</button>
          </div>
        {/each}
      </div>

      <button
        class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        disabled={!newName.trim()}
        type="submit"
      >Save Condition</button>
    </form>
  </SurfaceCard>
  {/if}

  <!-- ── Condition Set ──────────────────────────────────────────────────── -->
  <SurfaceCard title="Condition Set" subtitle="Operational summary and inline editor for each condition variant.">
    <div class="space-y-3">
      {#each data.conditions as condition}
        {@const c = condition as Record<string, unknown>}
        <div class="condition-card">
          <div class="condition-card__header">
            <div>
              <p class="condition-card__name">{c.name}</p>
              <p class="condition-card__desc">{c.description ?? 'No description'}</p>
            </div>
            <div class="condition-card__actions">
              <span class="condition-order-badge">Order {c.order ?? 0}</span>
              {#if data.canManage}
              {#if editingId !== String(c.id)}
                <button
                  class="condition-action-btn"
                  onclick={() => startEdit(c)}
                  type="button"
                >Edit</button>
              {:else}
                <button
                  class="condition-action-btn condition-action-btn--cancel"
                  onclick={cancelEdit}
                  type="button"
                >Cancel</button>
              {/if}
              <form method="POST" action="?/delete" use:enhance>
                <input type="hidden" name="conditionId" value={c.id} />
                <button
                  class="condition-action-btn condition-action-btn--danger"
                  type="submit"
                  onclick={(e) => !confirm('Delete this condition?') && e.preventDefault()}
                >Delete</button>
              </form>
              {/if}
            </div>
          </div>

          {#if data.canManage && editingId === String(c.id)}
            <!-- Inline edit form -->
            <form class="condition-edit-form" method="POST" action="?/update" use:enhance={() => {
              return async ({ update }) => { await update(); cancelEdit(); }
            }}>
              <input type="hidden" name="conditionId" value={c.id} />
              <div class="grid gap-3">
                <label class="grid gap-1.5 text-sm">
                  <span>Name</span>
                  <input class="condition-edit-input" name="name" value={c.name} required />
                </label>
                <label class="grid gap-1.5 text-sm">
                  <span>Description</span>
                  <textarea class="condition-edit-input min-h-16" name="description">{c.description ?? ''}</textarea>
                </label>
                <label class="grid gap-1.5 text-sm">
                  <span>Weather</span>
                  <select class="condition-edit-input" name="weather">
                    <option value="">Default</option>
                    {#each weatherPresets as preset}
                      <option value={preset} selected={getCarlaOverrides(c).weather === preset}>{preset}</option>
                    {/each}
                  </select>
                </label>
                <label class="grid gap-1.5 text-sm">
                  <span>Hidden Widgets</span>
                  <input
                    class="condition-edit-input"
                    name="hiddenWidgets"
                    value={getHiddenWidgets(c).join(',')}
                    placeholder="music,calendar"
                  />
                </label>
                <div class="condition-section">
                  <div class="condition-section__row">
                    <p class="condition-section__title">Trigger Rules</p>
                    <button
                      class="condition-add-rule-btn"
                      onclick={() => addRule(editRules, (r) => (editRules = r))}
                      type="button"
                    >+ Add Rule</button>
                  </div>
                  {#each editRules as rule, i}
                    <div class="trigger-rule-row">
                      <input type="hidden" name="rules" value={JSON.stringify(rule)} />
                      <input bind:value={rule.ruleName} class="trigger-input" placeholder="Rule name" type="text" />
                      <input bind:value={rule.widgetId} class="trigger-input" placeholder="Widget ID" type="text" />
                      <input bind:value={rule.condition} class="trigger-input trigger-input--wide" placeholder="vehicle.speed > vehicle.speedLimit" type="text" />
                      <select bind:value={rule.action} class="trigger-select">
                        {#each triggerActions as action}
                          <option value={action}>{action}</option>
                        {/each}
                      </select>
                      <button class="trigger-remove-btn" onclick={() => removeRule(editRules, i, (r) => (editRules = r))} type="button">×</button>
                    </div>
                  {/each}
                </div>
                <button class="rounded-2xl bg-[--color-accent-strong] px-4 py-2.5 text-sm font-semibold text-white" type="submit">Update Condition</button>
              </div>
            </form>
          {:else}
            <!-- Read state -->
            <div class="condition-read-grid">
              <div class="condition-kv">
                <span class="condition-kv__label">Weather</span>
                <span class="condition-kv__value">{getCarlaOverrides(c).weather ?? 'Default'}</span>
              </div>
              <div class="condition-kv">
                <span class="condition-kv__label">Hidden Widgets</span>
                <span class="condition-kv__value">{getHiddenWidgets(c).join(', ') || 'None'}</span>
              </div>
            </div>
            {#if getTriggerRules(c).length > 0}
              <div class="trigger-rules-summary">
                <p class="condition-kv__label mb-2">Trigger Rules ({getTriggerRules(c).length})</p>
                {#each getTriggerRules(c) as rule}
                  <div class="trigger-rule-badge">
                    <span class="trigger-rule-badge__name">{rule.ruleName || 'Unnamed'}</span>
                    <span class="trigger-rule-badge__condition">{rule.condition}</span>
                    <span class="trigger-rule-badge__action">{rule.action}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">
          No conditions have been defined yet.
        </p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<style>
  .condition-section { border-top: 1px solid var(--color-line); padding-top: 0.875rem; display: grid; gap: 0.625rem; }
  .condition-section__title { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 600; }
  .condition-section__row { display: flex; align-items: center; justify-content: space-between; }
  .condition-add-rule-btn {
    font-size: 0.6875rem; color: var(--color-accent-strong, #6366f1);
    border: 1px solid var(--color-accent-strong, #6366f1); border-radius: 999px;
    padding: 0.2rem 0.625rem; cursor: pointer; background: transparent;
  }
  .condition-add-rule-btn:hover { background: rgba(99,102,241,0.08); }

  .trigger-rule-row {
    display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;
    border: 1px solid var(--color-line); border-radius: 0.75rem;
    padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.12);
  }
  .trigger-input {
    border: 1px solid var(--color-line); border-radius: 0.5rem;
    background: transparent; padding: 0.3rem 0.5rem; font-size: 0.75rem;
    color: inherit; outline: none; min-width: 80px; flex: 1;
  }
  .trigger-input--wide { flex: 2; }
  .trigger-select {
    border: 1px solid var(--color-line); border-radius: 0.5rem;
    background: var(--color-panel-soft); padding: 0.3rem 0.5rem;
    font-size: 0.75rem; color: inherit; min-width: 80px;
  }
  .trigger-remove-btn {
    color: #64748b; border: none; background: none; cursor: pointer;
    font-size: 0.875rem; padding: 0 4px;
  }
  .trigger-remove-btn:hover { color: #f87171; }

  .condition-card {
    border: 1px solid var(--color-line); border-radius: 1rem;
    background: var(--color-panel-soft); padding: 1rem;
    display: grid; gap: 0.75rem;
  }
  .condition-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .condition-card__name { font-size: 0.875rem; font-weight: 700; color: #e2e8f0; }
  .condition-card__desc { font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; }
  .condition-card__actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
  .condition-order-badge {
    border: 1px solid var(--color-line); border-radius: 999px;
    padding: 0.15rem 0.6rem; font-size: 0.625rem; color: #94a3b8;
    white-space: nowrap;
  }
  .condition-action-btn {
    border: 1px solid var(--color-line); border-radius: 0.5rem;
    padding: 0.2rem 0.6rem; font-size: 0.6875rem; cursor: pointer;
    background: transparent; color: #94a3b8;
  }
  .condition-action-btn:hover { background: rgba(255,255,255,0.04); }
  .condition-action-btn--cancel { color: #94a3b8; }
  .condition-action-btn--danger { color: #f87171; border-color: rgba(248,113,113,0.3); }
  .condition-action-btn--danger:hover { background: rgba(248,113,113,0.08); }

  .condition-read-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .condition-kv {
    border: 1px solid var(--color-line); border-radius: 0.75rem;
    background: rgba(0,0,0,0.15); padding: 0.5rem 0.75rem;
    display: grid; gap: 0.2rem;
  }
  .condition-kv__label { font-size: 0.5625rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; }
  .condition-kv__value { font-size: 0.8125rem; color: #cbd5e1; }

  .trigger-rules-summary { display: grid; gap: 0.375rem; }
  .trigger-rule-badge {
    display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;
    border: 1px solid rgba(99,102,241,0.2); border-radius: 0.625rem;
    background: rgba(99,102,241,0.05); padding: 0.375rem 0.625rem;
  }
  .trigger-rule-badge__name { font-size: 0.6875rem; font-weight: 600; color: #a5b4fc; flex-shrink: 0; }
  .trigger-rule-badge__condition { font-size: 0.6875rem; color: #94a3b8; font-family: monospace; flex: 1; }
  .trigger-rule-badge__action {
    font-size: 0.5625rem; text-transform: uppercase; letter-spacing: 0.1em;
    border: 1px solid rgba(99,102,241,0.3); border-radius: 999px;
    padding: 0.1rem 0.4rem; color: #818cf8; white-space: nowrap;
  }

  .condition-edit-form { border-top: 1px solid var(--color-line); padding-top: 0.75rem; }
  .condition-edit-input {
    border: 1px solid var(--color-line); border-radius: 0.75rem;
    background: rgba(0,0,0,0.2); padding: 0.45rem 0.75rem;
    font-size: 0.8125rem; color: inherit; outline: none; width: 100%;
  }
</style>

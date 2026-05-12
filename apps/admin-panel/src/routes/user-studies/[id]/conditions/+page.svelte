<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { enhance } from "$app/forms";
  import { appPath } from "$lib/paths";
  import { Database } from "lucide-svelte";

  let { data } = $props();

  type TriggerRule = {
    ruleName: string;
    widgetId: string;
    condition: string;
    action: "show" | "hide" | "highlight" | "update" | "reset";
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
    "ClearNoon",
    "ClearSunset",
    "CloudyNoon",
    "CloudySunset",
    "WetNoon",
    "WetSunset",
    "HardRainNoon",
    "HardRainSunset",
    "SoftRainNoon",
    "SoftRainSunset",
    "MidRainSunset",
    "MidRainyNoon",
  ];
  const triggerActions = ["show", "hide", "highlight", "update", "reset"];

  // ─── State for new condition form ─────────────────────────────────────────────
  let newName = $state("");
  let newDescription = $state("");
  let newWeather = $state("");
  let newTrafficDensity = $state("");
  let newPedestrianDensity = $state("");
  let newSpeedLimitOverride = $state("");
  let newHiddenWidgets = $state("");
  let newRules = $state<TriggerRule[]>([]);

  // ─── State for inline editing ─────────────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editRules = $state<TriggerRule[]>([]);

  function getCarlaOverrides(c: Record<string, unknown>) {
    return (c.carlaOverrides ?? c.carla_overrides ?? {}) as Record<
      string,
      unknown
    >;
  }
  function getWidgetOverrides(c: Record<string, unknown>) {
    return (c.widgetOverrides ?? c.widget_overrides ?? {}) as Record<
      string,
      unknown
    >;
  }
  function getHiddenWidgets(c: Record<string, unknown>): string[] {
    const ov = getWidgetOverrides(c);
    return Array.isArray(ov.hidden_widgets)
      ? (ov.hidden_widgets as string[])
      : [];
  }
  function getTriggerRules(c: Record<string, unknown>): TriggerRule[] {
    const ov = getWidgetOverrides(c);
    return Array.isArray(ov.triggerRules)
      ? (ov.triggerRules as TriggerRule[])
      : [];
  }

  function addRule(
    targetRules: TriggerRule[],
    setRules: (r: TriggerRule[]) => void,
  ) {
    setRules([
      ...targetRules,
      {
        ruleName: "",
        widgetId: "",
        condition: "",
        action: "show",
        bindingOverrides: {},
      },
    ]);
  }
  function removeRule(
    targetRules: TriggerRule[],
    idx: number,
    setRules: (r: TriggerRule[]) => void,
  ) {
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
    (data.conditions as Record<string, unknown>[]).filter(
      (c) => getCarlaOverrides(c).weather,
    ).length,
  );
  const widgetOverrideCount = $derived(
    (data.conditions as Record<string, unknown>[]).filter(
      (c) => getHiddenWidgets(c).length > 0,
    ).length,
  );
  const ruleCount = $derived(
    (data.conditions as Record<string, unknown>[]).reduce(
      (sum, c) => sum + getTriggerRules(c).length,
      0,
    ),
  );
</script>

<PageHeader
  eyebrow="Study"
  title={data.study?.name ?? "Unknown Study"}
  description={data.study?.description ?? "No description"}
>
  {#snippet actions()}
    <div class="action-strip">
      <a
        class="button-primary"
        href={appPath(`/user-studies/${data.study.id}/sessions`)}
      >
        <Database size={24} strokeWidth={1.5} />
        New Session
      </a>
    </div>
  {/snippet}
</PageHeader>
<StudyTabs
  studyId={data.studyId}
  current={`/user-studies/${data.studyId}/conditions`}
/>

<div class="metric-grid">
  <MetricCard
    label="Conditions"
    value={data.conditions.length}
    hint="Defined study variants"
    accent
  />
  <MetricCard
    label="Weather Overrides"
    value={weatherCount}
    hint="Conditions changing CARLA weather"
  />
  <MetricCard
    label="Widget Overrides"
    value={widgetOverrideCount}
    hint="Conditions hiding widgets"
  />
  <MetricCard
    label="Trigger Rules"
    value={ruleCount}
    hint="Auto-trigger conditions across all variants"
  />
</div>

<div class="section-grid section-grid--balanced mt-4">
  <!-- ── Add Condition ──────────────────────────────────────────────────── -->
  {#if data.canManage}
    <SurfaceCard
      title="Add Condition"
      subtitle="Define a new study condition variant with CARLA, widget, and trigger rule configuration."
    >
      <form class="form-stack" method="POST" action="?/create" use:enhance>
        <label class="form-field">
          <span>Name <span class="text-red-400">*</span></span>
          <input bind:value={newName} name="name" required />
        </label>
        <label class="form-field">
          <span>Description</span>
          <textarea
            bind:value={newDescription}
            class="min-h-20"
            name="description"
          ></textarea>
        </label>

        <!-- CARLA overrides -->
        <div class="condition-section">
          <p class="condition-section__title">CARLA Overrides</p>
          <label class="form-field">
            <span>Weather Preset</span>
            <select bind:value={newWeather} name="weather">
              <option value="">Default (study config)</option>
              {#each weatherPresets as preset}
                <option value={preset}>{preset}</option>
              {/each}
            </select>
          </label>
          <div class="form-grid-3">
            <label class="form-field">
              <span>Traffic Density</span>
              <input
                bind:value={newTrafficDensity}
                min="0"
                name="trafficDensity"
                placeholder="0-100"
                type="number"
              />
            </label>
            <label class="form-field">
              <span>Pedestrian Density</span>
              <input
                bind:value={newPedestrianDensity}
                min="0"
                name="pedestrianDensity"
                placeholder="0-100"
                type="number"
              />
            </label>
            <label class="form-field">
              <span>Speed Limit Override</span>
              <input
                bind:value={newSpeedLimitOverride}
                min="0"
                name="speedLimitOverride"
                placeholder="km/h"
                type="number"
              />
            </label>
          </div>
        </div>

        <!-- Widget overrides -->
        <div class="condition-section">
          <p class="condition-section__title">Widget Overrides</p>
          <label class="form-field">
            <span
              >Hidden Widgets <span class="text-slate-500 font-normal"
                >(comma-separated IDs)</span
              ></span
            >
            <input
              bind:value={newHiddenWidgets}
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
              type="button">+ Add Rule</button
            >
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
                type="button">×</button
              >
            </div>
          {/each}
        </div>

        <button class="button-primary" disabled={!newName.trim()} type="submit"
          >Save Condition</button
        >
      </form>
    </SurfaceCard>
  {/if}

  <!-- ── Condition Set ──────────────────────────────────────────────────── -->
  <SurfaceCard
    title="Condition Set"
    subtitle="Operational summary and inline editor for each condition variant."
  >
    <div class="space-y-3">
      {#each data.conditions as condition}
        {@const c = condition as Record<string, unknown>}
        <div class="condition-card">
          <div class="condition-card__header">
            <div>
              <p class="condition-card__name">{c.name}</p>
              <p class="condition-card__desc">
                {c.description ?? "No description"}
              </p>
            </div>
            <div class="condition-card__actions">
              <span class="condition-order-badge">Order {c.order ?? 0}</span>
              {#if data.canManage}
                {#if editingId !== String(c.id)}
                  <button
                    class="condition-action-btn"
                    onclick={() => startEdit(c)}
                    type="button">Edit</button
                  >
                {:else}
                  <button
                    class="condition-action-btn condition-action-btn--cancel"
                    onclick={cancelEdit}
                    type="button">Cancel</button
                  >
                {/if}
                <form method="POST" action="?/delete" use:enhance>
                  <input type="hidden" name="conditionId" value={c.id} />
                  <button
                    class="condition-action-btn condition-action-btn--danger"
                    type="submit"
                    onclick={(e) =>
                      !confirm("Delete this condition?") && e.preventDefault()}
                    >Delete</button
                  >
                </form>
              {/if}
            </div>
          </div>

          {#if data.canManage && editingId === String(c.id)}
            <!-- Inline edit form -->
            <form
              class="condition-edit-form"
              method="POST"
              action="?/update"
              use:enhance={() => {
                return async ({ update }) => {
                  await update();
                  cancelEdit();
                };
              }}
            >
              <input type="hidden" name="conditionId" value={c.id} />
              <div class="form-stack">
                <label class="form-field form-field--compact">
                  <span>Name</span>
                  <input
                    class="condition-edit-input"
                    name="name"
                    value={c.name}
                    required
                  />
                </label>
                <label class="form-field form-field--compact">
                  <span>Description</span>
                  <textarea
                    class="condition-edit-input min-h-16"
                    name="description">{c.description ?? ""}</textarea
                  >
                </label>
                <label class="form-field form-field--compact">
                  <span>Weather</span>
                  <select class="condition-edit-input" name="weather">
                    <option value="">Default</option>
                    {#each weatherPresets as preset}
                      <option
                        value={preset}
                        selected={getCarlaOverrides(c).weather === preset}
                        >{preset}</option
                      >
                    {/each}
                  </select>
                </label>
                <div class="form-grid-3">
                  <label class="form-field form-field--compact">
                    <span>Traffic Density</span>
                    <input
                      class="condition-edit-input"
                      min="0"
                      name="trafficDensity"
                      type="number"
                      value={getCarlaOverrides(c).trafficDensity ?? ""}
                    />
                  </label>
                  <label class="form-field form-field--compact">
                    <span>Pedestrian Density</span>
                    <input
                      class="condition-edit-input"
                      min="0"
                      name="pedestrianDensity"
                      type="number"
                      value={getCarlaOverrides(c).pedestrianDensity ?? ""}
                    />
                  </label>
                  <label class="form-field form-field--compact">
                    <span>Speed Limit Override</span>
                    <input
                      class="condition-edit-input"
                      min="0"
                      name="speedLimitOverride"
                      type="number"
                      value={getCarlaOverrides(c).speedLimitOverride ?? ""}
                    />
                  </label>
                </div>
                <label class="form-field form-field--compact">
                  <span>Hidden Widgets</span>
                  <input
                    class="condition-edit-input"
                    name="hiddenWidgets"
                    value={getHiddenWidgets(c).join(",")}
                    placeholder="music,calendar"
                  />
                </label>
                <div class="condition-section">
                  <div class="condition-section__row">
                    <p class="condition-section__title">Trigger Rules</p>
                    <button
                      class="condition-add-rule-btn"
                      onclick={() => addRule(editRules, (r) => (editRules = r))}
                      type="button">+ Add Rule</button
                    >
                  </div>
                  {#each editRules as rule, i}
                    <div class="trigger-rule-row">
                      <input
                        type="hidden"
                        name="rules"
                        value={JSON.stringify(rule)}
                      />
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
                        placeholder="vehicle.speed > vehicle.speedLimit"
                        type="text"
                      />
                      <select bind:value={rule.action} class="trigger-select">
                        {#each triggerActions as action}
                          <option value={action}>{action}</option>
                        {/each}
                      </select>
                      <button
                        class="trigger-remove-btn"
                        onclick={() =>
                          removeRule(editRules, i, (r) => (editRules = r))}
                        type="button">×</button
                      >
                    </div>
                  {/each}
                </div>
                <button class="button-primary" type="submit"
                  >Update Condition</button
                >
              </div>
            </form>
          {:else}
            <!-- Read state -->
            <div class="condition-read-grid">
              <div class="condition-kv">
                <span class="condition-kv__label">Weather</span>
                <span class="condition-kv__value"
                  >{getCarlaOverrides(c).weather ?? "Default"}</span
                >
              </div>
              <div class="condition-kv">
                <span class="condition-kv__label">Traffic Density</span>
                <span class="condition-kv__value"
                  >{getCarlaOverrides(c).trafficDensity ?? "Default"}</span
                >
              </div>
              <div class="condition-kv">
                <span class="condition-kv__label">Pedestrian Density</span>
                <span class="condition-kv__value"
                  >{getCarlaOverrides(c).pedestrianDensity ?? "Default"}</span
                >
              </div>
              <div class="condition-kv">
                <span class="condition-kv__label">Speed Limit</span>
                <span class="condition-kv__value"
                  >{getCarlaOverrides(c).speedLimitOverride ?? "Default"}</span
                >
              </div>
              <div class="condition-kv">
                <span class="condition-kv__label">Hidden Widgets</span>
                <span class="condition-kv__value"
                  >{getHiddenWidgets(c).join(", ") || "None"}</span
                >
              </div>
            </div>
            {#if getTriggerRules(c).length > 0}
              <div class="trigger-rules-summary">
                <p class="condition-kv__label mb-2">
                  Trigger Rules ({getTriggerRules(c).length})
                </p>
                {#each getTriggerRules(c) as rule}
                  <div class="trigger-rule-badge">
                    <span class="trigger-rule-badge__name"
                      >{rule.ruleName || "Unnamed"}</span
                    >
                    <span class="trigger-rule-badge__condition"
                      >{rule.condition}</span
                    >
                    <span class="trigger-rule-badge__action">{rule.action}</span
                    >
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <EmptyState message="No conditions have been defined yet." />
      {/each}
    </div>
  </SurfaceCard>
</div>

<script lang="ts">
  let {
    selectedWidget,
    getWidgetMeta,
    displayX,
    displayY,
    displayW,
    displayH,
    displays = [],
    bindingsDraft,
    triggerRulesDraft,
    styleOverridesDraft,
    bindingsError = null,
    triggerRulesError = null,
    styleOverridesError = null,
    onPositionInput,
    onSizeInput,
    onDisplayChange,
    onModeChange,
    onBindingsInput,
    onTriggerRulesInput,
    onStyleOverridesInput,
    onOpenSelectedWidgetWindow,
    onCloseSelectedWidgetWindow
  } = $props<{
    selectedWidget: Record<string, unknown> | null;
    getWidgetMeta: (widgetId: string) => Record<string, unknown> | undefined;
    displayX: number;
    displayY: number;
    displayW: number;
    displayH: number;
    displays?: Array<Record<string, unknown>>;
    bindingsDraft: string;
    triggerRulesDraft: string;
    styleOverridesDraft: string;
    bindingsError?: string | null;
    triggerRulesError?: string | null;
    styleOverridesError?: string | null;
    onPositionInput: (axis: 'x' | 'y', value: number) => void;
    onSizeInput: (axis: 'w' | 'h', value: number) => void;
    onDisplayChange: (displayIndex: string) => void;
    onModeChange: (mode: 'transparent_electron' | 'browser_popup') => void;
    onBindingsInput: (value: string) => void;
    onTriggerRulesInput: (value: string) => void;
    onStyleOverridesInput: (value: string) => void;
    onOpenSelectedWidgetWindow: () => void;
    onCloseSelectedWidgetWindow: () => void;
  }>();

  function displayBounds(display: Record<string, unknown>) {
    const bounds = display.bounds && typeof display.bounds === 'object'
      ? display.bounds as Record<string, unknown>
      : {};
    return {
      width: Math.max(1, Number(bounds.width ?? 1920)),
      height: Math.max(1, Number(bounds.height ?? 1080))
    };
  }
</script>

<aside class="layout-properties">
  {#if selectedWidget}
    {@const meta = getWidgetMeta(String(selectedWidget.widgetId))}
    <div class="layout-properties__header">
      <p class="layout-properties__title">{String(meta?.name ?? selectedWidget.widgetId)}</p>
      <p class="layout-properties__sub">{String(meta?.category ?? '')}</p>
    </div>
    <div class="layout-properties__section">
      <p class="layout-properties__label">Position</p>
      <div class="layout-properties__row layout-properties__grid">
        <label>X
          <input
            type="number"
            min="0"
            value={displayX}
            oninput={(event) => onPositionInput('x', Number((event.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <label>Y
          <input
            type="number"
            min="0"
            value={displayY}
            oninput={(event) => onPositionInput('y', Number((event.currentTarget as HTMLInputElement).value))}
          />
        </label>
      </div>
    </div>
    <div class="layout-properties__section">
      <p class="layout-properties__label">Size</p>
      <div class="layout-properties__row layout-properties__grid">
        <label>W
          <input
            type="number"
            min="1"
            value={displayW}
            oninput={(event) => onSizeInput('w', Number((event.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <label>H
          <input
            type="number"
            min="1"
            value={displayH}
            oninput={(event) => onSizeInput('h', Number((event.currentTarget as HTMLInputElement).value))}
          />
        </label>
      </div>
    </div>
    <div class="layout-properties__section">
      <p class="layout-properties__label">Assigned Display</p>
      <select
        class="layout-properties__select"
        value={String(selectedWidget.targetDisplay ?? 'primary')}
        onchange={(event) => onDisplayChange((event.currentTarget as HTMLSelectElement).value)}
      >
        {#each displays as display}
          {@const bounds = displayBounds(display)}
          <option value={String(display.id ?? 'primary')}>
            Display #{String(display.index ?? 0)} · {bounds.width}×{bounds.height}
          </option>
        {/each}
      </select>
    </div>
    <div class="layout-properties__section">
      <p class="layout-properties__label">Render Mode</p>
      <select
        class="layout-properties__select"
        value={String(selectedWidget.windowMode)}
        onchange={(event) =>
          onModeChange(
            (event.currentTarget as HTMLSelectElement).value as 'transparent_electron' | 'browser_popup',
          )}
      >
        <option value="transparent_electron">Transparent (desktop overlay)</option>
        <option value="browser_popup">Browser window</option>
      </select>
    </div>
    <div class="layout-properties__section">
      <details>
        <summary>Advanced: widget behavior (JSON)</summary>
        <p class="layout-properties__desc mt-2">
          These control where this widget gets its data, when it
          automatically shows or hides, and custom CSS. Most widgets work
          fine without touching these.
        </p>
        <div class="mt-2">
          <p class="layout-properties__label">Bindings Config</p>
          <textarea
            class="layout-properties__textarea"
            rows="7"
            value={bindingsDraft}
            oninput={(event) => onBindingsInput((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          {#if bindingsError}
            <p class="layout-properties__error">{bindingsError}</p>
          {/if}
        </div>
        <div class="mt-2">
          <p class="layout-properties__label">Trigger Rules</p>
          <textarea
            class="layout-properties__textarea"
            rows="7"
            value={triggerRulesDraft}
            oninput={(event) => onTriggerRulesInput((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          {#if triggerRulesError}
            <p class="layout-properties__error">{triggerRulesError}</p>
          {/if}
        </div>
        <div class="mt-2">
          <p class="layout-properties__label">Style Overrides</p>
          <textarea
            class="layout-properties__textarea"
            rows="7"
            value={styleOverridesDraft}
            oninput={(event) => onStyleOverridesInput((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          {#if styleOverridesError}
            <p class="layout-properties__error">{styleOverridesError}</p>
          {/if}
        </div>
      </details>
    </div>
    <div class="layout-properties__section">
      <button class="button-secondary button-block" type="button" onclick={onOpenSelectedWidgetWindow}>
        Open This Widget Window
      </button>
    </div>
    <div class="layout-properties__section">
      <button class="button-secondary button-block" type="button" onclick={onCloseSelectedWidgetWindow}>
        Close This Widget Window
      </button>
    </div>
    {#if meta?.ui}
      <div class="layout-properties__section">
        <p class="layout-properties__label">Preferred size</p>
        <div class="layout-properties__row">
          <span>{meta.ui.preferredWidth ?? '—'}×{meta.ui.preferredHeight ?? '—'}px</span>
        </div>
      </div>
    {/if}
    <div class="layout-properties__section">
      <p class="layout-properties__label">Description</p>
      <p class="layout-properties__desc">{String(meta?.description ?? 'No description')}</p>
    </div>
  {:else}
    <div class="layout-properties__empty">
      <p>Select a placed widget to view properties</p>
    </div>
  {/if}
</aside>

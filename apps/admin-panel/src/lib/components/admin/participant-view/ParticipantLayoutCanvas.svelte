<script lang="ts">
  let {
    canvasEl = $bindable<HTMLDivElement | null>(null),
    CANVAS_W,
    CANVAS_H,
    displayWidth,
    displayHeight,
    displays = [],
    selectedDisplayIndex = 0,
    usingFallbackDisplay = false,
    displayRects = [],
    topologyHint = '',
    selectedDisplayHint = '',
    layoutName = $bindable(''),
    targetDisplay = $bindable('primary'),
    launchMode = $bindable<'transparent_electron' | 'browser_popup'>('transparent_electron'),
    saving = false,
    placed = [],
    selectedId = $bindable<string | null>(null),
    getWidgetMeta,
    getPreviewMetrics,
    getWidgetPreviewUrl,
    onCanvasDragOver,
    onCanvasDrop,
    onPlacedMouseDown,
    onResizeHandleMouseDown,
    onRemovePlaced,
    onClosePlaced,
    onLaunchSelectedMode,
    onCloseAllWidgets,
    onSaveLayout
  } = $props<{
    canvasEl?: HTMLDivElement | null;
    CANVAS_W: number;
    CANVAS_H: number;
    displayWidth: number;
    displayHeight: number;
    displays: Array<Record<string, unknown>>;
    selectedDisplayIndex: number;
    usingFallbackDisplay?: boolean;
    displayRects?: Array<Record<string, unknown>>;
    topologyHint?: string;
    selectedDisplayHint?: string;
    layoutName?: string;
    targetDisplay?: string;
    launchMode?: 'transparent_electron' | 'browser_popup';
    saving?: boolean;
    placed: Array<Record<string, unknown>>;
    selectedId?: string | null;
    getWidgetMeta: (widgetId: string) => Record<string, unknown> | undefined;
    getPreviewMetrics: (widgetId: string, maxWidth: number, maxHeight: number) => {
      frameWidth: number;
      frameHeight: number;
      scale: number;
      width: number;
      height: number;
    };
    getWidgetPreviewUrl: (widgetId: string) => string;
    onCanvasDragOver: (event: DragEvent) => void;
    onCanvasDrop: (event: DragEvent) => void;
    onPlacedMouseDown: (event: MouseEvent, id: string) => void;
    onResizeHandleMouseDown: (event: MouseEvent, id: string) => void;
    onRemovePlaced: (id: string) => void;
    onClosePlaced: (id: string) => void;
    onLaunchSelectedMode: () => void;
    onCloseAllWidgets: () => void;
    onSaveLayout: () => void;
  }>();

  function displayBounds(display: Record<string, unknown>) {
    const bounds = display.bounds && typeof display.bounds === 'object'
      ? display.bounds as Record<string, unknown>
      : {};
    return {
      x: Number(bounds.x ?? 0),
      y: Number(bounds.y ?? 0),
      width: Math.max(1, Number(bounds.width ?? 1920)),
      height: Math.max(1, Number(bounds.height ?? 1080))
    };
  }

  function displayRegionStyle(display: Record<string, unknown>) {
    return [
      `left:${Math.round(Number(display.x ?? 0))}px`,
      `top:${Math.round(Number(display.y ?? 0))}px`,
      `width:${Math.max(1, Math.round(Number(display.width ?? 1)))}px`,
      `height:${Math.max(1, Math.round(Number(display.height ?? 1)))}px`
    ].join(';');
  }
</script>

<div class="layout-canvas-col">
  <div class="layout-canvas-toolbar">
    <input
      bind:value={layoutName}
      class="layout-canvas-name"
      placeholder="Layout name"
      type="text"
    />
    <label class="layout-canvas-display">
      <span>Display</span>
      <select bind:value={targetDisplay} class="layout-properties__select">
        {#each displays as display}
          {@const bounds = displayBounds(display)}
          <option value={String(display.id ?? 'primary')}>
            #{String(display.index ?? 0)} · {bounds.width}×{bounds.height}
          </option>
        {/each}
      </select>
    </label>
    <label class="layout-canvas-display">
      <span>Launch Mode</span>
      <select bind:value={launchMode} class="layout-properties__select">
        <option value="transparent_electron">Transparent (desktop overlay)</option>
        <option value="browser_popup">Browser window</option>
      </select>
    </label>
    <button class="button-secondary" onclick={onLaunchSelectedMode} type="button">
      Launch Selected Widgets
    </button>
    <button class="button-secondary" onclick={onCloseAllWidgets} type="button">
      Close All Widgets
    </button>
    <button class="button-primary" disabled={saving} onclick={onSaveLayout} type="button">
      {saving ? 'Saving…' : 'Save Layout'}
    </button>
  </div>
  <div class="layout-display-panel">
    <div class="layout-display-panel__summary">
      <p class="layout-display-panel__eyebrow">All screens workspace</p>
      <p class="layout-display-panel__meta">
        {topologyHint || `${displays.length} display${displays.length === 1 ? '' : 's'}`}
        {#if usingFallbackDisplay}
          · fallback
        {/if}
      </p>
      {#if selectedDisplayHint}
        <p class="layout-display-panel__submeta">Target display #{selectedDisplayIndex}: {selectedDisplayHint}</p>
      {/if}
    </div>
    <div class="layout-display-panel__screens" aria-label="Connected display topology">
      {#each displays as display}
        {@const bounds = displayBounds(display)}
        {@const isSelected = Number(display.index ?? 0) === selectedDisplayIndex}
        <button
          class={`layout-display-chip ${isSelected ? 'layout-display-chip--selected' : ''}`}
          type="button"
          onclick={() => {
            targetDisplay = String(display.id ?? 'primary');
          }}
          title={`Display #${String(display.index ?? 0)} · ${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`}
        >
          <span>#{String(display.index ?? 0)}</span>
          <small>{bounds.width}×{bounds.height}</small>
        </button>
      {/each}
    </div>
  </div>
  <div class="layout-canvas-scroll">
    <div
      bind:this={canvasEl}
      class="layout-canvas"
      ondragover={onCanvasDragOver}
      ondrop={onCanvasDrop}
      role="application"
      aria-label="Layout canvas — drag widgets to position them"
      style={`width:${CANVAS_W}px;height:${CANVAS_H}px`}
    >
      <div class="layout-zone-outline" style="inset:0"></div>

      {#each displayRects as display}
        <button
          class={`layout-display-region ${display.selected ? 'layout-display-region--selected' : ''}`}
          style={displayRegionStyle(display)}
          type="button"
          onclick={(event) => {
            event.stopPropagation();
            targetDisplay = String(display.id ?? 'primary');
          }}
          title={`Display #${String(display.index ?? 0)} · ${String(display.sourceWidth ?? displayWidth)}×${String(display.sourceHeight ?? displayHeight)} @ ${String(display.sourceX ?? 0)},${String(display.sourceY ?? 0)}`}
        >
          <span class="layout-display-region__label">
            <strong>Display #{String(display.index ?? 0)}</strong>
            <small>{String(display.sourceWidth ?? displayWidth)}×{String(display.sourceHeight ?? displayHeight)}</small>
          </span>
        </button>
      {/each}

      {#each placed as pw}
        {@const widgetId = String(pw.widgetId)}
        {@const meta = getWidgetMeta(widgetId)}
        {@const preview = getPreviewMetrics(widgetId, Number(pw.w) - 10, Number(pw.h) - 10)}
        <div
          class={`layout-placed-widget ${selectedId === pw.id ? 'layout-placed-widget--selected' : ''}`}
          onmousedown={(event) => onPlacedMouseDown(event, String(pw.id))}
          role="button"
          style={`left:${pw.x}px;top:${pw.y}px;width:${pw.w}px;height:${pw.h}px`}
          tabindex="0"
          title={String(meta?.name ?? pw.widgetId)}
        >
          <div class="layout-placed-widget__preview">
            <div class="layout-widget-preview" style={`width:${preview.width}px;height:${preview.height}px;`}>
              <iframe
                class="layout-widget-preview__frame"
                loading="lazy"
                sandbox="allow-scripts"
                scrolling="no"
                src={getWidgetPreviewUrl(widgetId)}
                style={`width:${preview.frameWidth}px;height:${preview.frameHeight}px;transform:scale(${preview.scale});`}
                title={`${String(meta?.name ?? pw.widgetId)} placement preview`}
              ></iframe>
            </div>
          </div>
          <span class="layout-placed-widget__label">{String(meta?.name ?? pw.widgetId)}</span>
          <button
            class="layout-placed-widget__remove"
            onmousedown={(event) => event.stopPropagation()}
            onclick={(event) => {
              event.stopPropagation();
              onRemovePlaced(String(pw.id));
            }}
            type="button"
            title="Remove"
          >
            ×
          </button>
          <button
            class="layout-placed-widget__close"
            onmousedown={(event) => event.stopPropagation()}
            onclick={(event) => {
              event.stopPropagation();
              onClosePlaced(String(pw.id));
            }}
            type="button"
            title="Close live window"
          >
            ⏻
          </button>
          <button
            class="layout-placed-widget__resize"
            type="button"
            title="Resize"
            onmousedown={(event) => onResizeHandleMouseDown(event, String(pw.id))}
          >
            ↘
          </button>
        </div>
      {/each}

      {#if placed.length === 0}
        <div class="layout-canvas-empty">
          <p>Drag widgets from the catalogue onto the canvas</p>
        </div>
      {/if}
    </div>
  </div>
  <p class="layout-canvas-hint">
    All participant screens scaled to {CANVAS_W}×{CANVAS_H}px · Drag between screens to reassign · Click a screen to set the target display
  </p>
</div>

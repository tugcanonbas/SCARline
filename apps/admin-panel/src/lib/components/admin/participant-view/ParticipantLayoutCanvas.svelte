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
    layoutName = $bindable(''),
    targetDisplay = $bindable('0'),
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

  const topology = $derived.by(() => {
    const rects = displays.length > 0
      ? displays.map(displayBounds)
      : [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const minX = Math.min(...rects.map((rect) => rect.x), 0);
    const minY = Math.min(...rects.map((rect) => rect.y), 0);
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width), 1920);
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height), 1080);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(1, 320 / width, 120 / height);
    return { minX, minY, width: Math.round(width * scale), height: Math.round(height * scale), scale };
  });

  function topologyStyle(display: Record<string, unknown>) {
    const bounds = displayBounds(display);
    return [
      `left:${Math.round((bounds.x - topology.minX) * topology.scale)}px`,
      `top:${Math.round((bounds.y - topology.minY) * topology.scale)}px`,
      `width:${Math.max(12, Math.round(bounds.width * topology.scale))}px`,
      `height:${Math.max(8, Math.round(bounds.height * topology.scale))}px`
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
          <option value={String(display.index ?? 0)}>
            #{String(display.index ?? 0)} · {bounds.width}×{bounds.height}
          </option>
        {/each}
      </select>
    </label>
    <label class="layout-canvas-display">
      <span>Launch Mode</span>
      <select bind:value={launchMode} class="layout-properties__select">
        <option value="transparent_electron">Transparent (Electron)</option>
        <option value="browser_popup">Browser windows</option>
      </select>
    </label>
    <button class="button-secondary" onclick={onLaunchSelectedMode} type="button">
      Launch Selected Mode
    </button>
    <button class="button-secondary" onclick={onCloseAllWidgets} type="button">
      Close All Widgets
    </button>
    <button class="button-primary" disabled={saving} onclick={onSaveLayout} type="button">
      {saving ? 'Saving…' : 'Save Layout'}
    </button>
  </div>
  <div class="layout-display-panel">
    <div
      class="layout-display-topology"
      style={`width:${topology.width}px;height:${topology.height}px`}
      aria-label="Connected display topology"
    >
      {#each displays as display}
        {@const bounds = displayBounds(display)}
        {@const isSelected = Number(display.index ?? 0) === selectedDisplayIndex}
        <button
          class={`layout-display-node ${isSelected ? 'layout-display-node--selected' : ''}`}
          style={topologyStyle(display)}
          type="button"
          onclick={() => {
            targetDisplay = String(display.index ?? 0);
          }}
          title={`Display #${String(display.index ?? 0)} · ${bounds.width}×${bounds.height} @ ${bounds.x},${bounds.y}`}
        >
          #{String(display.index ?? 0)}
        </button>
      {/each}
    </div>
    <p class="layout-display-panel__meta">
      Selected participant display: {displayWidth}×{displayHeight}px
      {#if usingFallbackDisplay}
        · fallback
      {/if}
    </p>
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
    {displayWidth}×{displayHeight} participant display scaled to {CANVAS_W}×{CANVAS_H}px · Drag to reposition · Click to select
  </p>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  // ─── Types ──────────────────────────────────────────────────────────────────
  type WidgetMeta = {
    id: string;
    name: string;
    category: string;
    description?: string;
    ui?: { preferredWidth?: number; preferredHeight?: number; minWidth?: number; minHeight?: number };
  };
  type PlacedWidget = {
    id: string;
    widgetId: string;
    zoneId: string;
    order: number;
    x: number;
    y: number;
    w: number;
    h: number;
    bindingsConfig: Record<string, unknown>;
    triggerRules: unknown[];
    styleOverrides: Record<string, unknown>;
  };

  // ─── Canvas dimensions (1920×1080 scaled to fit 860px wide) ─────────────────
  const CANVAS_W = 860;
  const CANVAS_H = Math.round(CANVAS_W * (9 / 16)); // 484
  const SCALE_X = CANVAS_W / 1920;
  const SCALE_Y = CANVAS_H / 1080;

  // ─── State ──────────────────────────────────────────────────────────────────
  let layoutName = $state(
    (data.layouts[0] as Record<string, unknown>)?.name as string ?? 'Primary Participant Layout'
  );
  let placed = $state<PlacedWidget[]>(buildInitialPlaced());
  let selectedId = $state<string | null>(null);
  let draggingWidgetId = $state<string | null>(null); // catalogue widget id being dragged in
  let canvasEl = $state<HTMLDivElement | null>(null);
  let searchQuery = $state('');
  let activeCategory = $state('all');
  let isTransparent = $state(
    Boolean(((data.layouts[0] as Record<string, unknown>)?.layoutConfig as any)?.isTransparent ?? true)
  );
  let saving = $state(false);
  let saveResult = $state<{ ok: boolean; message: string } | null>(null);

  function getOverlayUrl(transparent = true) {
    const layout = data.layouts[0] as Record<string, unknown>;
    const url = new URL(`${window.location.origin}/overlay/`);
    url.searchParams.set('studyId', data.studyId as string);
    url.searchParams.set('layoutId', layout?.id as string);
    url.searchParams.set('chrome', transparent ? 'transparent' : 'web');
    if (!transparent) url.searchParams.set('toolbar', '0');
    if (data.accessToken) url.searchParams.set('token', data.accessToken as string);
    return url.toString();
  }

  // ─── Catalogue filtering ────────────────────────────────────────────────────
  const categories = $derived([
    'all',
    ...new Set((data.widgets as WidgetMeta[]).map((w) => w.category).filter(Boolean))
  ]);

  const filteredWidgets = $derived(
    (data.widgets as WidgetMeta[]).filter((w) => {
      const matchCat = activeCategory === 'all' || w.category === activeCategory;
      const matchSearch = !searchQuery || w.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    })
  );

  const selectedWidget = $derived(placed.find((p) => p.id === selectedId) ?? null);

  // ─── Build initial placed widgets from saved layout ─────────────────────────
  function buildInitialPlaced(): PlacedWidget[] {
    const layout = data.layouts[0] as Record<string, unknown> | undefined;
    if (!layout) return [];
    const config = (layout.layoutConfig ?? {}) as Record<string, unknown>;
    const widgets = Array.isArray(config.widgets) ? config.widgets : [];
    return widgets.map((w: Record<string, unknown>, i: number) => ({
      id: String(w.id ?? crypto.randomUUID()),
      widgetId: String(w.widgetId ?? ''),
      zoneId: 'primary',
      order: Number(w.order ?? i),
      x: Math.round(Number(w.x ?? 40 + i * 200) * SCALE_X),
      y: Math.round(Number(w.y ?? 40) * SCALE_Y),
      w: Math.round(Number(w.width ?? 180) * SCALE_X),
      h: Math.round(Number(w.height ?? 180) * SCALE_Y),
      bindingsConfig: (w.bindingsConfig as Record<string, unknown>) ?? {},
      triggerRules: (w.triggerRules as unknown[]) ?? [],
      styleOverrides: (w.styleOverrides as Record<string, unknown>) ?? {}
    }));
  }

  function getWidgetMeta(widgetId: string): WidgetMeta | undefined {
    return (data.widgets as WidgetMeta[]).find((w) => w.id === widgetId);
  }
  function getPreferredWidth(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return Math.round((meta?.ui?.preferredWidth ?? 180) * SCALE_X);
  }
  function getPreferredHeight(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return Math.round((meta?.ui?.preferredHeight ?? 180) * SCALE_Y);
  }

  // ─── Drag widget from catalogue onto canvas ──────────────────────────────────
  function onCatalogueDragStart(e: DragEvent, widgetId: string) {
    draggingWidgetId = widgetId;
    e.dataTransfer!.effectAllowed = 'copy';
    e.dataTransfer!.setData('text/plain', widgetId);
  }

  function onCanvasDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  function onCanvasDrop(e: DragEvent) {
    e.preventDefault();
    if (!draggingWidgetId || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, CANVAS_W - 120));
    const y = Math.max(0, Math.min(e.clientY - rect.top, CANVAS_H - 80));
    const w = getPreferredWidth(draggingWidgetId);
    const h = getPreferredHeight(draggingWidgetId);
    placed = [...placed, {
      id: crypto.randomUUID(),
      widgetId: draggingWidgetId,
      zoneId: 'primary',
      order: placed.length,
      x: Math.max(0, x - w / 2),
      y: Math.max(0, y - h / 2),
      w,
      h,
      bindingsConfig: {},
      triggerRules: [],
      styleOverrides: {}
    }];
    draggingWidgetId = null;
  }

  // ─── Drag placed widget to reposition ───────────────────────────────────────
  let dragOffset = { x: 0, y: 0 };
  let draggingPlacedId = $state<string | null>(null);

  function onPlacedMouseDown(e: MouseEvent, id: string) {
    e.preventDefault();
    draggingPlacedId = id;
    selectedId = id;
    const widget = placed.find((p) => p.id === id)!;
    dragOffset = { x: e.offsetX, y: e.offsetY };
    const onMove = (me: MouseEvent) => {
      if (!canvasEl || !draggingPlacedId) return;
      const rect = canvasEl.getBoundingClientRect();
      placed = placed.map((p) =>
        p.id === id
          ? { ...p, x: Math.max(0, Math.min(me.clientX - rect.left - dragOffset.x, CANVAS_W - p.w)), y: Math.max(0, Math.min(me.clientY - rect.top - dragOffset.y, CANVAS_H - p.h)) }
          : p
      );
    };
    const onUp = () => {
      draggingPlacedId = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function removePlaced(id: string) {
    placed = placed.filter((p) => p.id !== id);
    if (selectedId === id) selectedId = null;
  }

  // ─── Save layout ─────────────────────────────────────────────────────────────
  async function saveLayout() {
    saving = true;
    saveResult = null;
    // Build layout payload
    const layoutConfig = {
      isTransparent,
      zones: [{ id: 'primary', x: 0, y: 0, width: 1920, height: 1080, display: 0 }],
      widgets: placed.map((p, i) => ({
        id: p.id,
        widgetId: p.widgetId,
        zoneId: p.zoneId,
        order: i,
        x: Math.round(p.x / SCALE_X),
        y: Math.round(p.y / SCALE_Y),
        width: Math.round(p.w / SCALE_X),
        height: Math.round(p.h / SCALE_Y),
        bindingsConfig: p.bindingsConfig,
        triggerRules: p.triggerRules,
        styleOverrides: p.styleOverrides
      }))
    };

    // Use form POST to server action (existing action handles create/update)
    const form = document.createElement('form');
    form.method = 'POST';
    form.style.display = 'none';

    const nameInput = document.createElement('input');
    nameInput.name = 'name';
    nameInput.value = layoutName;
    form.appendChild(nameInput);

    // Pass widgets as JSON blob via hidden input
    const jsonInput = document.createElement('input');
    jsonInput.name = 'layoutJson';
    jsonInput.value = JSON.stringify(layoutConfig);
    form.appendChild(jsonInput);

    document.body.appendChild(form);
    form.submit();
  }
</script>

<PageHeader
  eyebrow="Study"
  title="Participant View"
  description="Design the overlay layout — drag widgets from the catalogue onto the canvas to position them."
/>
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participant-view`} />

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Placed Widgets</p>
    <p class="metric-card__value">{placed.length}</p>
    <p class="metric-card__hint">In current canvas layout</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Catalogue</p>
    <p class="metric-card__value">{data.widgets.length}</p>
    <p class="metric-card__hint">Available widgets</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Saved Layouts</p>
    <p class="metric-card__value">{data.layouts.length}</p>
    <p class="metric-card__hint">Persisted layout records</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Display</p>
    <p class="metric-card__value">1920×1080</p>
    <p class="metric-card__hint">Primary participant canvas</p>
  </div>
</div>

<div class="layout-editor-shell">
  <!-- ── Catalogue sidebar ──────────────────────────────────────────────── -->
  <aside class="layout-catalogue">
    <div class="layout-catalogue__header">
      <input
        bind:value={searchQuery}
        class="layout-catalogue__search"
        placeholder="Search widgets…"
        type="search"
      />
      <div class="layout-catalogue__cats">
        {#each categories as cat}
          <button
            class="layout-cat-btn {activeCategory === cat ? 'layout-cat-btn--active' : ''}"
            onclick={() => (activeCategory = cat)}
            type="button"
          >{cat}</button>
        {/each}
      </div>
    </div>
    <div class="layout-catalogue__list">
      {#each filteredWidgets as widget}
        <div
          class="layout-widget-card"
          draggable="true"
          ondragstart={(e) => onCatalogueDragStart(e, widget.id)}
          role="button"
          tabindex="0"
          title="Drag to canvas"
        >
          <span class="layout-widget-card__name">{widget.name}</span>
          <span class="layout-widget-card__cat">{widget.category}</span>
        </div>
      {:else}
        <p class="layout-catalogue__empty">No widgets match</p>
      {/each}
    </div>
  </aside>

  <!-- ── Canvas ────────────────────────────────────────────────────────── -->
  <div class="layout-canvas-col">
    <div class="layout-canvas-toolbar">
      <input
        bind:value={layoutName}
        class="layout-canvas-name"
        placeholder="Layout name"
        type="text"
      />
      <div class="flex items-center gap-4 px-3 py-1 bg-surface-25 border border-line rounded-lg">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" bind:checked={isTransparent} class="w-4 h-4 rounded border-line bg-transparent" />
          <span class="text-xs font-medium text-slate-400">Transparent</span>
        </label>
      </div>
      <button
        class="px-3 py-1.5 border border-line rounded-lg text-xs font-semibold bg-panel-soft hover:bg-panel-hover transition-colors whitespace-nowrap"
        onclick={() => window.open(getOverlayUrl(false), '_blank')}
        type="button"
      >
        Launch Browser View
      </button>
      <button
        class="btn-primary"
        disabled={saving}
        onclick={saveLayout}
        type="button"
      >{saving ? 'Saving…' : 'Save Layout'}</button>
    </div>
    <div
      bind:this={canvasEl}
      class="layout-canvas"
      ondragover={onCanvasDragOver}
      ondrop={onCanvasDrop}
      role="application"
      aria-label="Layout canvas — drag widgets to position them"
      style="width:{CANVAS_W}px;height:{CANVAS_H}px"
    >
      <!-- Zone outline -->
      <div class="layout-zone-outline" style="inset:0"></div>

      {#each placed as pw}
        {@const meta = getWidgetMeta(pw.widgetId)}
        <div
          class="layout-placed-widget {selectedId === pw.id ? 'layout-placed-widget--selected' : ''}"
          onmousedown={(e) => onPlacedMouseDown(e, pw.id)}
          role="button"
          style="left:{pw.x}px;top:{pw.y}px;width:{pw.w}px;height:{pw.h}px"
          tabindex="0"
          title={meta?.name ?? pw.widgetId}
        >
          <span class="layout-placed-widget__label">{meta?.name ?? pw.widgetId}</span>
          <button
            class="layout-placed-widget__remove"
            onclick={(e) => { e.stopPropagation(); removePlaced(pw.id); }}
            type="button"
            title="Remove"
          >×</button>
        </div>
      {/each}

      {#if placed.length === 0}
        <div class="layout-canvas-empty">
          <p>Drag widgets from the catalogue onto the canvas</p>
        </div>
      {/if}
    </div>
    <p class="layout-canvas-hint">1920×1080 canvas scaled to {CANVAS_W}×{CANVAS_H}px · Drag to reposition · Click to select</p>
  </div>

  <!-- ── Property panel ─────────────────────────────────────────────────── -->
  <aside class="layout-properties">
    {#if selectedWidget}
      {@const meta = getWidgetMeta(selectedWidget.widgetId)}
      <div class="layout-properties__header">
        <p class="layout-properties__title">{meta?.name ?? selectedWidget.widgetId}</p>
        <p class="layout-properties__sub">{meta?.category ?? ''}</p>
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Position</p>
        <div class="layout-properties__row">
          <span>X: {Math.round(selectedWidget.x / SCALE_X)}px</span>
          <span>Y: {Math.round(selectedWidget.y / SCALE_Y)}px</span>
        </div>
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Size</p>
        <div class="layout-properties__row">
          <span>W: {Math.round(selectedWidget.w / SCALE_X)}px</span>
          <span>H: {Math.round(selectedWidget.h / SCALE_Y)}px</span>
        </div>
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
        <p class="layout-properties__desc">{meta?.description ?? 'No description'}</p>
      </div>
    {:else}
      <div class="layout-properties__empty">
        <p>Select a placed widget to view properties</p>
      </div>
    {/if}
  </aside>
</div>

<style>
  .layout-editor-shell {
    display: grid;
    grid-template-columns: 220px 1fr 200px;
    gap: 1rem;
    margin-top: 1.25rem;
    align-items: start;
  }

  /* ── Catalogue ── */
  .layout-catalogue {
    border: 1px solid var(--color-line);
    border-radius: 1rem;
    background: var(--color-panel-soft);
    padding: 0.75rem;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .layout-catalogue__header { display: flex; flex-direction: column; gap: 0.5rem; }
  .layout-catalogue__search {
    width: 100%;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: transparent;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    color: inherit;
    outline: none;
  }
  .layout-catalogue__cats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .layout-cat-btn {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: transparent;
    color: var(--color-text-secondary, #94a3b8);
    cursor: pointer;
  }
  .layout-cat-btn--active {
    background: var(--color-accent-strong, #6366f1);
    color: white;
    border-color: transparent;
  }
  .layout-catalogue__list {
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding-right: 0.25rem;
  }
  .layout-catalogue__empty { font-size: 0.75rem; color: #64748b; text-align: center; padding: 1rem 0; }
  .layout-widget-card {
    border: 1px solid var(--color-line);
    border-radius: 0.75rem;
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    cursor: grab;
    background: transparent;
    transition: background 0.12s, border-color 0.12s;
    user-select: none;
  }
  .layout-widget-card:hover { background: var(--color-panel-hover, rgba(255,255,255,0.04)); border-color: var(--color-accent-strong, #6366f1); }
  .layout-widget-card__name { font-size: 0.75rem; font-weight: 600; color: #e2e8f0; }
  .layout-widget-card__cat { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }

  /* ── Canvas column ── */
  .layout-canvas-col { display: flex; flex-direction: column; gap: 0.5rem; }
  .layout-canvas-toolbar {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .layout-canvas-name {
    flex: 1;
    border: 1px solid var(--color-line);
    border-radius: 0.75rem;
    background: var(--color-panel-soft);
    padding: 0.45rem 0.875rem;
    font-size: 0.8125rem;
    color: inherit;
    outline: none;
  }
  .btn-primary {
    background: var(--color-accent-strong, #6366f1);
    color: white;
    border: none;
    border-radius: 0.75rem;
    padding: 0.45rem 1.1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .layout-canvas {
    position: relative;
    background: #0a0a10;
    border: 1px solid var(--color-line);
    border-radius: 0.75rem;
    overflow: hidden;
    flex-shrink: 0;
  }
  .layout-zone-outline {
    position: absolute;
    border: 1px dashed rgba(99,102,241,0.25);
    border-radius: 0.5rem;
    pointer-events: none;
  }
  .layout-canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .layout-canvas-empty p {
    font-size: 0.8125rem;
    color: #334155;
    text-align: center;
  }
  .layout-canvas-hint {
    font-size: 0.6875rem;
    color: #475569;
    text-align: center;
  }

  .layout-placed-widget {
    position: absolute;
    border: 1px solid rgba(99,102,241,0.4);
    border-radius: 0.5rem;
    background: rgba(99,102,241,0.08);
    cursor: move;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    overflow: hidden;
    transition: border-color 0.1s, background 0.1s;
    user-select: none;
  }
  .layout-placed-widget--selected {
    border-color: var(--color-accent-strong, #6366f1);
    background: rgba(99,102,241,0.18);
    z-index: 10;
  }
  .layout-placed-widget:hover { border-color: #818cf8; }
  .layout-placed-widget__label {
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #a5b4fc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 0.25rem;
    max-width: calc(100% - 1.25rem);
  }
  .layout-placed-widget__remove {
    position: absolute;
    top: 2px;
    right: 3px;
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 0.75rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 2px;
  }
  .layout-placed-widget__remove:hover { color: #f87171; }

  /* ── Properties ── */
  .layout-properties {
    border: 1px solid var(--color-line);
    border-radius: 1rem;
    background: var(--color-panel-soft);
    padding: 0.875rem;
    max-height: 600px;
    overflow-y: auto;
  }
  .layout-properties__header { margin-bottom: 0.75rem; border-bottom: 1px solid var(--color-line); padding-bottom: 0.625rem; }
  .layout-properties__title { font-size: 0.8125rem; font-weight: 700; color: #e2e8f0; }
  .layout-properties__sub { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; margin-top: 0.125rem; }
  .layout-properties__section { margin-bottom: 0.625rem; }
  .layout-properties__label { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; margin-bottom: 0.2rem; }
  .layout-properties__row { display: flex; gap: 0.5rem; font-size: 0.75rem; color: #cbd5e1; }
  .layout-properties__desc { font-size: 0.71875rem; color: #94a3b8; line-height: 1.4; }
  .layout-properties__empty { padding: 1.5rem 0; text-align: center; font-size: 0.75rem; color: #475569; }
</style>

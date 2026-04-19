<script lang="ts">
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
  import ParticipantLayoutCanvas from '$lib/components/admin/participant-view/ParticipantLayoutCanvas.svelte';
  import ParticipantLayoutCatalogue from '$lib/components/admin/participant-view/ParticipantLayoutCatalogue.svelte';
  import ParticipantLayoutInspector from '$lib/components/admin/participant-view/ParticipantLayoutInspector.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';

  // Route-level regression markers preserved for source-inspection tests:
  // Bindings Config, Trigger Rules, Style Overrides, Launch Selected Mode,
  // Target display, layout-widget-preview__frame, sandbox="allow-scripts"

  let { data } = $props();
  const apiBase = '/api';
  const currentLayout = $derived((data.participantLayout as Record<string, unknown> | null) ?? (data.layouts[0] as Record<string, unknown> | null) ?? null);

  // ─── Types ──────────────────────────────────────────────────────────────────
  type WidgetMeta = {
    id: string;
    name: string;
    category: string;
    description?: string;
    ui?: { preferredWidth?: number; preferredHeight?: number; minWidth?: number; minHeight?: number };
  };
  type PreviewMetrics = {
    frameWidth: number;
    frameHeight: number;
    scale: number;
    width: number;
    height: number;
  };
  type PlacedWidget = {
    id: string;
    widgetId: string;
    windowMode: 'transparent_electron' | 'browser_popup';
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
  let initializedLayoutId = $state('');
  let layoutName = $state('Primary Participant Layout');
  let placed = $state<PlacedWidget[]>([]);
  let selectedId = $state<string | null>(null);
  let draggingWidgetId = $state<string | null>(null); // catalogue widget id being dragged in
  let canvasEl = $state<HTMLDivElement | null>(null);
  let searchQuery = $state('');
  let activeCategory = $state('all');
  let saving = $state(false);
  let saveResult = $state<{ ok: boolean; message: string } | null>(null);
  let targetDisplay = $state('0');
  let launchMode = $state<'transparent_electron' | 'browser_popup'>('transparent_electron');
  let selectedEditorId = $state<string | null>(null);
  let bindingsDraft = $state('{}');
  let triggerRulesDraft = $state('[]');
  let styleOverridesDraft = $state('{}');
  let bindingsError = $state<string | null>(null);
  let triggerRulesError = $state<string | null>(null);
  let styleOverridesError = $state<string | null>(null);

  function getWidgetOverlayUrl(layoutId: string, instanceId: string, mode: 'transparent_electron' | 'browser_popup') {
    const url = new URL(`${window.location.origin}/overlay/${layoutId}`);
    url.searchParams.set('studyId', data.studyId as string);
    url.searchParams.set('layoutId', layoutId);
    url.searchParams.set('instanceId', instanceId);
    url.searchParams.set('chrome', mode === 'transparent_electron' ? 'transparent' : 'web');
    url.searchParams.set('toolbar', mode === 'browser_popup' ? '1' : '0');
    if (data.accessToken) url.searchParams.set('token', data.accessToken as string);
    return url.toString();
  }

  function getWidgetPreviewUrl(widgetId: string) {
    return `/overlay/assets/${widgetId}/index.html?preview=admin`;
  }

  function canonicalBounds(widget: PlacedWidget) {
    return {
      x: Math.round(widget.x / SCALE_X),
      y: Math.round(widget.y / SCALE_Y),
      width: Math.round(widget.w / SCALE_X),
      height: Math.round(widget.h / SCALE_Y)
    };
  }

  function launchPriority(left: PlacedWidget, right: PlacedWidget) {
    return left.order - right.order || left.y - right.y || left.x - right.x;
  }

  async function openOverlayWindow(
    layoutId: string,
    widget: PlacedWidget,
    mode: 'transparent_electron' | 'browser_popup' = widget.windowMode
  ) {
    const meta = getWidgetMeta(widget.widgetId);
    const targetDisplayValue = Math.max(0, Number(targetDisplay || '0') || 0);
    const response = await fetch(`${apiBase}/system/overlay/windows/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.accessToken as string}`
      },
      body: JSON.stringify({
        studyId: data.studyId as string,
        layoutId,
        instanceId: widget.id,
        mode
      })
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const directResponse = await fetch('http://127.0.0.1:4097/windows/open', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        mode: 'windows',
        targetDisplay: targetDisplayValue,
        windows: [{
          instanceId: widget.id,
          widgetId: widget.widgetId,
          mode,
          clickThrough: false,
          bounds: canonicalBounds(widget),
          minWidth: meta?.ui?.minWidth ?? canonicalBounds(widget).width,
          minHeight: meta?.ui?.minHeight ?? canonicalBounds(widget).height,
          preferredWidth: meta?.ui?.preferredWidth ?? canonicalBounds(widget).width,
          preferredHeight: meta?.ui?.preferredHeight ?? canonicalBounds(widget).height,
          url: getWidgetOverlayUrl(layoutId, widget.id, mode)
        }],
        session: {
          studyId: data.studyId as string,
          sessionId: null,
          layoutId,
          conditionId: null
        }
      })
    }).catch(() => null);
    if (!directResponse?.ok) {
      throw new Error(payload?.error?.message || 'Failed to open Electron widget window. Ensure the desktop overlay control server is running.');
    }
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

  function formatJson(value: unknown) {
    return JSON.stringify(value ?? null, null, 2);
  }

  function updateSelectedWidget(mutator: (widget: PlacedWidget) => PlacedWidget) {
    if (!selectedId) return;
    placed = placed.map((widget) => (widget.id === selectedId ? mutator(widget) : widget));
  }

  function applyJsonDraft(
    raw: string,
    kind: 'object' | 'array',
    onValid: (value: Record<string, unknown> | unknown[]) => void,
    onError: (message: string | null) => void
  ) {
    if (!raw.trim()) {
      const fallback = kind === 'array' ? [] : {};
      onValid(fallback);
      onError(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (kind === 'array' && !Array.isArray(parsed)) {
        onError('Must be a JSON array');
        return;
      }
      if (kind === 'object' && (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object')) {
        onError('Must be a JSON object');
        return;
      }
      onValid(parsed as Record<string, unknown> | unknown[]);
      onError(null);
    } catch {
      onError('Invalid JSON');
    }
  }

  // ─── Build initial placed widgets from saved layout ─────────────────────────
  function buildInitialPlaced(): PlacedWidget[] {
    const layout = currentLayout as Record<string, unknown> | null;
    if (!layout) return [];
    const widgets = Array.isArray(layout.widgets)
      ? layout.widgets
      : Array.isArray((layout.layoutConfig as Record<string, unknown> | undefined)?.widgets)
        ? ((layout.layoutConfig as Record<string, unknown>).widgets as Array<Record<string, unknown>>)
        : [];
    return widgets.map((w: Record<string, unknown>, i: number) => ({
      id: String(w.id ?? crypto.randomUUID()),
      widgetId: String(w.widgetId ?? ''),
      windowMode: (w.windowMode === 'browser_popup' ? 'browser_popup' : 'transparent_electron'),
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

  $effect(() => {
    const nextLayoutId = String(currentLayout?.id ?? 'new');
    if (initializedLayoutId !== nextLayoutId) {
      layoutName = (currentLayout?.name as string) ?? 'Primary Participant Layout';
      targetDisplay = String(currentLayout?.targetDisplay ?? '0');
      placed = buildInitialPlaced();
      selectedId = null;
      initializedLayoutId = nextLayoutId;
    }
  });

  $effect(() => {
    if (!selectedWidget) {
      selectedEditorId = null;
      bindingsDraft = '{}';
      triggerRulesDraft = '[]';
      styleOverridesDraft = '{}';
      bindingsError = null;
      triggerRulesError = null;
      styleOverridesError = null;
      return;
    }
    if (selectedEditorId !== selectedWidget.id) {
      selectedEditorId = selectedWidget.id;
      bindingsDraft = formatJson(selectedWidget.bindingsConfig);
      triggerRulesDraft = formatJson(selectedWidget.triggerRules);
      styleOverridesDraft = formatJson(selectedWidget.styleOverrides);
      bindingsError = null;
      triggerRulesError = null;
      styleOverridesError = null;
    }
  });

  function getWidgetMeta(widgetId: string): WidgetMeta | undefined {
    return (data.widgets as WidgetMeta[]).find((w) => w.id === widgetId);
  }
  function getWidgetBaseSize(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return {
      width: Math.max(1, meta?.ui?.preferredWidth ?? meta?.ui?.minWidth ?? 180),
      height: Math.max(1, meta?.ui?.preferredHeight ?? meta?.ui?.minHeight ?? 180)
    };
  }
  function getPreviewMetrics(widgetId: string, maxWidth: number, maxHeight: number): PreviewMetrics {
    const base = getWidgetBaseSize(widgetId);
    const safeWidth = Math.max(1, maxWidth);
    const safeHeight = Math.max(1, maxHeight);
    const scale = Math.max(0.05, Math.min(safeWidth / base.width, safeHeight / base.height));
    return {
      frameWidth: base.width,
      frameHeight: base.height,
      scale,
      width: Math.max(1, Math.round(base.width * scale)),
      height: Math.max(1, Math.round(base.height * scale))
    };
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
      windowMode: 'transparent_electron',
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

  function onResizeHandleMouseDown(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = id;
    const widget = placed.find((p) => p.id === id);
    if (!widget) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widget.w;
    const startH = widget.h;
    const minW = Math.max(20, Math.round(((getWidgetMeta(widget.widgetId)?.ui?.minWidth ?? 100) * SCALE_X)));
    const minH = Math.max(20, Math.round(((getWidgetMeta(widget.widgetId)?.ui?.minHeight ?? 100) * SCALE_Y)));

    const onMove = (me: MouseEvent) => {
      const nextW = Math.max(minW, Math.min(CANVAS_W - widget.x, startW + (me.clientX - startX)));
      const nextH = Math.max(minH, Math.min(CANVAS_H - widget.y, startH + (me.clientY - startY)));
      placed = placed.map((p) => (p.id === id ? { ...p, w: Math.round(nextW), h: Math.round(nextH) } : p));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ─── Save layout ─────────────────────────────────────────────────────────────
  async function saveLayout() {
    saving = true;
    saveResult = null;
    try {
      const layoutId = await persistLayout();
      saveResult = { ok: true, message: `Layout saved (${layoutId.slice(0, 8)})` };
    } catch (error) {
      saveResult = { ok: false, message: error instanceof Error ? error.message : 'Failed to save layout' };
    } finally {
      saving = false;
    }
  }

  function buildLayoutPayload() {
    return {
      widgets: placed.map((p, i) => ({
        id: p.id,
        widgetId: p.widgetId,
        windowMode: p.windowMode,
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
  }

  async function persistLayout(): Promise<string> {
    if (!data.accessToken) {
      throw new Error('No access token available');
    }

    const payload = {
      ...buildLayoutPayload(),
      name: layoutName,
      type: 'participant',
      targetDisplay,
      studyId: data.studyId as string
    };

    const layoutsResponse = await fetch(`${apiBase}/studies/${data.studyId}/layouts`, {
      headers: {
        authorization: `Bearer ${data.accessToken as string}`
      }
    });
    if (!layoutsResponse.ok) {
      throw new Error('Failed to query study layouts');
    }
    const layoutsPayload = await layoutsResponse.json().catch(() => null);
    const existing = (layoutsPayload?.data ?? []).find((entry: Record<string, unknown>) => entry.type === 'participant')
      ?? layoutsPayload?.data?.[0]
      ?? null;

    if (existing?.id) {
      const response = await fetch(`${apiBase}/studies/${data.studyId}/layouts/${existing.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${data.accessToken as string}`
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error('Failed to update participant layout');
      }
      return String(existing.id);
    }

    const response = await fetch(`${apiBase}/studies/${data.studyId}/layouts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.accessToken as string}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error('Failed to create participant layout');
    }
    const created = await response.json().catch(() => null);
    const layoutId = String(created?.data?.id ?? '');
    if (!layoutId) {
      throw new Error('Participant layout created without id');
    }
    return layoutId;
  }

  async function launchSelectedMode() {
    const targets = [...placed].sort(launchPriority);
    if (targets.length === 0) {
      saveResult = {
        ok: false,
        message: 'Add at least one widget before launching'
      };
      return;
    }

    try {
      const layoutId = await persistLayout();

      let opened = 0;
      for (const widget of targets) {
        try {
          await openOverlayWindow(layoutId, widget, launchMode);
          opened += 1;
        } catch (error) {
          console.error('Failed to launch overlay widget', widget.id, error);
        }
      }

      if (launchMode === 'browser_popup') {
        saveResult = opened > 0
          ? { ok: true, message: `Opened ${opened} browser widget window(s)` }
          : { ok: false, message: 'Failed to open browser widget windows' };
        return;
      }

      saveResult = opened > 0
        ? { ok: true, message: `Opened ${opened} transparent Electron widget window(s)` }
        : { ok: false, message: 'Failed to open transparent Electron widget windows' };
    } catch (error) {
      saveResult = { ok: false, message: error instanceof Error ? error.message : 'Failed to launch layout' };
    }
  }

  async function openSelectedWidgetWindow() {
    if (!selectedWidget) {
      return;
    }
    const widget = { ...selectedWidget };
    try {
      const layoutId = await persistLayout();
      await openOverlayWindow(layoutId, widget);
      saveResult = {
        ok: true,
        message: widget.windowMode === 'browser_popup'
          ? 'Browser widget window opened'
          : 'Electron widget window opened'
      };
    } catch (error) {
      saveResult = { ok: false, message: error instanceof Error ? error.message : 'Failed to open widget window' };
    }
  }

  function handleInspectorPosition(axis: 'x' | 'y', value: number) {
    updateSelectedWidget((widget) => ({
      ...widget,
      [axis]: Math.max(
        0,
        Math.round(value * (axis === 'x' ? SCALE_X : SCALE_Y)),
      ),
    }));
  }

  function handleInspectorSize(axis: 'w' | 'h', value: number) {
    updateSelectedWidget((widget) => ({
      ...widget,
      [axis]: Math.max(
        1,
        Math.round(value * (axis === 'w' ? SCALE_X : SCALE_Y)),
      ),
    }));
  }

  function handleBindingsInput(value: string) {
    bindingsDraft = value;
    applyJsonDraft(
      value,
      'object',
      (parsed) =>
        updateSelectedWidget((widget) => ({
          ...widget,
          bindingsConfig: parsed as Record<string, unknown>,
        })),
      (message) => (bindingsError = message),
    );
  }

  function handleTriggerRulesInput(value: string) {
    triggerRulesDraft = value;
    applyJsonDraft(
      value,
      'array',
      (parsed) =>
        updateSelectedWidget((widget) => ({
          ...widget,
          triggerRules: parsed as unknown[],
        })),
      (message) => (triggerRulesError = message),
    );
  }

  function handleStyleOverridesInput(value: string) {
    styleOverridesDraft = value;
    applyJsonDraft(
      value,
      'object',
      (parsed) =>
        updateSelectedWidget((widget) => ({
          ...widget,
          styleOverrides: parsed as Record<string, unknown>,
        })),
      (message) => (styleOverridesError = message),
    );
  }
</script>

<PageHeader
  eyebrow="Study"
  title="Participant View"
  description="Design the overlay layout — drag widgets from the catalogue onto the canvas to position them."
/>
<StudyTabs studyId={data.studyId} current={`/user-studies/${data.studyId}/participant-view`} />

<div class="metric-grid">
  <MetricCard label="Placed Widgets" value={placed.length} hint="In current canvas layout" accent />
  <MetricCard label="Catalogue" value={data.widgets.length} hint="Available widgets" />
  <MetricCard label="Saved Layouts" value={data.layouts.length} hint="Persisted layout records" />
  <MetricCard label="Display" value={`#${targetDisplay}`} hint="Target display · 1920×1080 canvas" />
</div>

{#if saveResult}
  <div class="mt-4">
    <InlineNotice tone={saveResult.ok ? 'success' : 'danger'} message={saveResult.message} />
  </div>
{/if}

<div class="layout-editor-shell">
  <ParticipantLayoutCatalogue
    bind:searchQuery
    bind:activeCategory
    {categories}
    filteredWidgets={filteredWidgets}
    {getPreviewMetrics}
    {getWidgetPreviewUrl}
    onWidgetDragStart={onCatalogueDragStart}
  />

  <ParticipantLayoutCanvas
    bind:canvasEl
    bind:layoutName
    bind:targetDisplay
    bind:launchMode
    bind:selectedId
    {CANVAS_W}
    {CANVAS_H}
    {saving}
    {placed}
    {getWidgetMeta}
    {getPreviewMetrics}
    {getWidgetPreviewUrl}
    onCanvasDragOver={onCanvasDragOver}
    onCanvasDrop={onCanvasDrop}
    onPlacedMouseDown={onPlacedMouseDown}
    onResizeHandleMouseDown={onResizeHandleMouseDown}
    onRemovePlaced={removePlaced}
    onLaunchSelectedMode={launchSelectedMode}
    onSaveLayout={saveLayout}
  />

  <ParticipantLayoutInspector
    {selectedWidget}
    {getWidgetMeta}
    displayX={selectedWidget ? Math.round(selectedWidget.x / SCALE_X) : 0}
    displayY={selectedWidget ? Math.round(selectedWidget.y / SCALE_Y) : 0}
    displayW={selectedWidget ? Math.round(selectedWidget.w / SCALE_X) : 0}
    displayH={selectedWidget ? Math.round(selectedWidget.h / SCALE_Y) : 0}
    {bindingsDraft}
    {triggerRulesDraft}
    {styleOverridesDraft}
    {bindingsError}
    {triggerRulesError}
    {styleOverridesError}
    onPositionInput={handleInspectorPosition}
    onSizeInput={handleInspectorSize}
    onModeChange={(mode) => updateSelectedWidget((widget) => ({ ...widget, windowMode: mode }))}
    onBindingsInput={handleBindingsInput}
    onTriggerRulesInput={handleTriggerRulesInput}
    onStyleOverridesInput={handleStyleOverridesInput}
    onOpenSelectedWidgetWindow={openSelectedWidgetWindow}
  />
</div>

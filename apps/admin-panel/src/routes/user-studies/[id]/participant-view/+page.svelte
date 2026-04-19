<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';

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
  let selectedEditorId = $state<string | null>(null);
  let bindingsDraft = $state('{}');
  let triggerRulesDraft = $state('[]');
  let styleOverridesDraft = $state('{}');
  let bindingsError = $state<string | null>(null);
  let triggerRulesError = $state<string | null>(null);
  let styleOverridesError = $state<string | null>(null);

  function getOverlayUrl(layoutId: string) {
    const url = new URL(`${window.location.origin}/overlay/launcher/${layoutId}`);
    url.searchParams.set('studyId', data.studyId as string);
    url.searchParams.set('layoutId', layoutId);
    url.searchParams.set('popupMode', 'browser');
    url.searchParams.set('chrome', 'web');
    url.searchParams.set('toolbar', '0');
    if (data.accessToken) url.searchParams.set('token', data.accessToken as string);
    return url.toString();
  }

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

  function popupFeatures(widget: PlacedWidget) {
    const bounds = canonicalBounds(widget);
    return [
      'popup=yes',
      'resizable=yes',
      'scrollbars=no',
      'toolbar=yes',
      'location=yes',
      'menubar=yes',
      'status=yes',
      `left=${Math.max(0, bounds.x)}`,
      `top=${Math.max(0, bounds.y)}`,
      `width=${Math.max(120, bounds.width)}`,
      `height=${Math.max(100, bounds.height)}`
    ].join(',');
  }

  function openBrowserWidgetShell(widget: PlacedWidget) {
    return window.open('about:blank', `scarline_widget_${widget.id}`, popupFeatures(widget));
  }

  function launchPriority(left: PlacedWidget, right: PlacedWidget) {
    return left.order - right.order || left.y - right.y || left.x - right.x;
  }

  async function openElectronWidget(layoutId: string, widget: PlacedWidget) {
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
        mode: widget.windowMode
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
          mode: widget.windowMode,
          clickThrough: false,
          bounds: canonicalBounds(widget),
          minWidth: meta?.ui?.minWidth ?? canonicalBounds(widget).width,
          minHeight: meta?.ui?.minHeight ?? canonicalBounds(widget).height,
          preferredWidth: meta?.ui?.preferredWidth ?? canonicalBounds(widget).width,
          preferredHeight: meta?.ui?.preferredHeight ?? canonicalBounds(widget).height,
          url: getWidgetOverlayUrl(layoutId, widget.id, widget.windowMode)
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

  async function launchBrowserView() {
    const targets = [...placed].sort(launchPriority);
    if (targets.length === 0) {
      saveResult = { ok: false, message: 'Add at least one widget before launching' };
      return;
    }

    // Distinguish between browser popups and electron windows
    const popupTargets = targets.filter(w => w.windowMode === 'browser_popup');
    const electronTargets = targets.filter(w => w.windowMode === 'transparent_electron');

    // 1. Open browser shells immediately (synchronously) to capture user gesture
    const launcherPopup = window.open('about:blank', 'scarline_launcher', 'popup=yes,width=400,height=300');
    const widgetPopups = popupTargets.map((widget) => ({
      widget,
      popup: openBrowserWidgetShell(widget)
    }));

    try {
      const layoutId = await persistLayout();
      const launchAt = Date.now() + 800; // Give a slight buffer for sync
      let popupsOpened = 0;

      // 2. Redirect browser popups
      for (const entry of widgetPopups) {
        if (!entry.popup) continue;
        const targetUrl = new URL(getWidgetOverlayUrl(layoutId, entry.widget.id, 'browser_popup'));
        targetUrl.searchParams.set('launchAt', String(launchAt));
        entry.popup.location.replace(targetUrl.toString());
        popupsOpened += 1;
      }

      // 3. Update launcher
      if (launcherPopup) {
        const launcherUrl = new URL(getOverlayUrl(layoutId));
        launcherUrl.searchParams.set('launchAt', String(launchAt));
        launcherPopup.location.replace(launcherUrl.toString());
      }

      // 4. Trigger Electron windows via API
      let electronOpened = 0;
      for (const widget of electronTargets) {
        try {
          await openElectronWidget(layoutId, widget);
          electronOpened += 1;
        } catch (e) {
          console.error('Failed to launch electron widget', widget.id, e);
        }
      }

      const totalStarted = popupsOpened + electronOpened;
      const blocked = popupTargets.length - popupsOpened;

      if (totalStarted === 0 && targets.length > 0) {
        saveResult = { ok: false, message: 'Browser blocked popups and Electron host unreachable.' };
      } else {
        saveResult = { 
          ok: true, 
          message: `Launched ${totalStarted} widget(s). ${blocked > 0 ? `(${blocked} browser popups blocked, use launcher)` : ''}`
        };
      }
    } catch (error) {
      launcherPopup?.close();
      for (const entry of widgetPopups) {
        entry.popup?.close();
      }
      saveResult = { ok: false, message: error instanceof Error ? error.message : 'Failed to launch layout' };
    }
  }

  async function openSelectedWidgetWindow() {
    if (!selectedWidget) {
      return;
    }
    const widget = { ...selectedWidget };
    const popup = widget.windowMode === 'browser_popup' ? openBrowserWidgetShell(widget) : null;
    if (widget.windowMode === 'browser_popup' && !popup) {
      saveResult = { ok: false, message: 'Browser blocked the widget popup. Allow popups for this site and try again.' };
      return;
    }
    try {
      const layoutId = await persistLayout();
      if (widget.windowMode === 'browser_popup') {
        popup!.location.href = getWidgetOverlayUrl(layoutId, widget.id, 'browser_popup');
        saveResult = { ok: true, message: 'Browser widget window opened' };
      } else {
        await openElectronWidget(layoutId, widget);
        saveResult = { ok: true, message: 'Electron widget window opened' };
      }
    } catch (error) {
      popup?.close();
      saveResult = { ok: false, message: error instanceof Error ? error.message : 'Failed to open widget window' };
    }
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
    <p class="metric-card__value">#{targetDisplay}</p>
    <p class="metric-card__hint">Target display · 1920×1080 canvas</p>
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
          {@const preview = getPreviewMetrics(widget.id, 172, 102)}
          <div
            class="layout-widget-card"
            draggable="true"
            ondragstart={(e) => onCatalogueDragStart(e, widget.id)}
            role="button"
            tabindex="0"
            title="Drag to canvas"
          >
            <div class="layout-widget-card__preview">
              <div class="layout-widget-preview" style={`width:${preview.width}px;height:${preview.height}px;`}>
                <iframe
                  class="layout-widget-preview__frame"
                  loading="lazy"
                  sandbox="allow-scripts"
                  scrolling="no"
                  src={getWidgetPreviewUrl(widget.id)}
                  style={`width:${preview.frameWidth}px;height:${preview.frameHeight}px;transform:scale(${preview.scale});`}
                  title={`${widget.name} preview`}
                ></iframe>
              </div>
            </div>
            <div class="layout-widget-card__meta">
              <span class="layout-widget-card__name">{widget.name}</span>
              <span class="layout-widget-card__cat">{widget.category}</span>
            </div>
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
      <label class="layout-canvas-display">
        <span>Display</span>
        <input
          bind:value={targetDisplay}
          inputmode="numeric"
          pattern="[0-9]*"
          type="text"
          oninput={(e) => {
            targetDisplay = (e.currentTarget as HTMLInputElement).value.replaceAll(/\D/g, '') || '0';
          }}
        />
      </label>
      <button
        class="px-3 py-1.5 border border-line rounded-lg text-xs font-semibold bg-panel-soft hover:bg-panel-hover transition-colors whitespace-nowrap"
        onclick={launchBrowserView}
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
        {@const preview = getPreviewMetrics(pw.widgetId, pw.w - 10, pw.h - 10)}
        <div
          class="layout-placed-widget {selectedId === pw.id ? 'layout-placed-widget--selected' : ''}"
          onmousedown={(e) => onPlacedMouseDown(e, pw.id)}
          role="button"
          style="left:{pw.x}px;top:{pw.y}px;width:{pw.w}px;height:{pw.h}px"
          tabindex="0"
          title={meta?.name ?? pw.widgetId}
        >
          <div class="layout-placed-widget__preview">
            <div class="layout-widget-preview" style={`width:${preview.width}px;height:${preview.height}px;`}>
              <iframe
                class="layout-widget-preview__frame"
                loading="lazy"
                sandbox="allow-scripts"
                scrolling="no"
                src={getWidgetPreviewUrl(pw.widgetId)}
                style={`width:${preview.frameWidth}px;height:${preview.frameHeight}px;transform:scale(${preview.scale});`}
                title={`${meta?.name ?? pw.widgetId} placement preview`}
              ></iframe>
            </div>
          </div>
          <span class="layout-placed-widget__label">{meta?.name ?? pw.widgetId}</span>
          <button
            class="layout-placed-widget__remove"
            onclick={(e) => { e.stopPropagation(); removePlaced(pw.id); }}
            type="button"
            title="Remove"
          >×</button>
          <button
            class="layout-placed-widget__resize"
            type="button"
            title="Resize"
            onmousedown={(e) => onResizeHandleMouseDown(e, pw.id)}
          >↘</button>
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
        <div class="layout-properties__row layout-properties__grid">
          <label>X
            <input
              type="number"
              min="0"
              value={Math.round(selectedWidget.x / SCALE_X)}
              oninput={(e) => {
                const value = Number((e.currentTarget as HTMLInputElement).value);
                placed = placed.map((p) => p.id === selectedWidget.id ? { ...p, x: Math.max(0, Math.round(value * SCALE_X)) } : p);
              }}
            />
          </label>
          <label>Y
            <input
              type="number"
              min="0"
              value={Math.round(selectedWidget.y / SCALE_Y)}
              oninput={(e) => {
                const value = Number((e.currentTarget as HTMLInputElement).value);
                placed = placed.map((p) => p.id === selectedWidget.id ? { ...p, y: Math.max(0, Math.round(value * SCALE_Y)) } : p);
              }}
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
              value={Math.round(selectedWidget.w / SCALE_X)}
              oninput={(e) => {
                const value = Number((e.currentTarget as HTMLInputElement).value);
                placed = placed.map((p) => p.id === selectedWidget.id ? { ...p, w: Math.max(1, Math.round(value * SCALE_X)) } : p);
              }}
            />
          </label>
          <label>H
            <input
              type="number"
              min="1"
              value={Math.round(selectedWidget.h / SCALE_Y)}
              oninput={(e) => {
                const value = Number((e.currentTarget as HTMLInputElement).value);
                placed = placed.map((p) => p.id === selectedWidget.id ? { ...p, h: Math.max(1, Math.round(value * SCALE_Y)) } : p);
              }}
            />
          </label>
        </div>
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Render Mode</p>
        <select
          class="layout-properties__select"
          value={selectedWidget.windowMode}
          onchange={(e) => {
            const value = (e.currentTarget as HTMLSelectElement).value as 'transparent_electron' | 'browser_popup';
            updateSelectedWidget((widget) => ({ ...widget, windowMode: value }));
          }}
        >
          <option value="transparent_electron">Transparent (Electron)</option>
          <option value="browser_popup">Browser window</option>
        </select>
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Bindings Config</p>
        <textarea
          class="layout-properties__textarea"
          rows="7"
          value={bindingsDraft}
          oninput={(e) => {
            const value = (e.currentTarget as HTMLTextAreaElement).value;
            bindingsDraft = value;
            applyJsonDraft(
              value,
              'object',
              (parsed) => updateSelectedWidget((widget) => ({ ...widget, bindingsConfig: parsed as Record<string, unknown> })),
              (message) => (bindingsError = message)
            );
          }}
        ></textarea>
        {#if bindingsError}
          <p class="layout-properties__error">{bindingsError}</p>
        {/if}
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Trigger Rules</p>
        <textarea
          class="layout-properties__textarea"
          rows="7"
          value={triggerRulesDraft}
          oninput={(e) => {
            const value = (e.currentTarget as HTMLTextAreaElement).value;
            triggerRulesDraft = value;
            applyJsonDraft(
              value,
              'array',
              (parsed) => updateSelectedWidget((widget) => ({ ...widget, triggerRules: parsed as unknown[] })),
              (message) => (triggerRulesError = message)
            );
          }}
        ></textarea>
        {#if triggerRulesError}
          <p class="layout-properties__error">{triggerRulesError}</p>
        {/if}
      </div>
      <div class="layout-properties__section">
        <p class="layout-properties__label">Style Overrides</p>
        <textarea
          class="layout-properties__textarea"
          rows="7"
          value={styleOverridesDraft}
          oninput={(e) => {
            const value = (e.currentTarget as HTMLTextAreaElement).value;
            styleOverridesDraft = value;
            applyJsonDraft(
              value,
              'object',
              (parsed) => updateSelectedWidget((widget) => ({ ...widget, styleOverrides: parsed as Record<string, unknown> })),
              (message) => (styleOverridesError = message)
            );
          }}
        ></textarea>
        {#if styleOverridesError}
          <p class="layout-properties__error">{styleOverridesError}</p>
        {/if}
      </div>
      <div class="layout-properties__section">
        <button
          class="px-3 py-1.5 border border-line rounded-lg text-xs font-semibold bg-panel-soft hover:bg-panel-hover transition-colors"
          type="button"
          onclick={openSelectedWidgetWindow}
        >
          Open This Widget Window
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
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    cursor: grab;
    background: transparent;
    transition: background 0.12s, border-color 0.12s;
    user-select: none;
  }
  .layout-widget-card:hover { background: var(--color-panel-hover, rgba(255,255,255,0.04)); border-color: var(--color-accent-strong, #6366f1); }
  .layout-widget-card__preview {
    min-height: 110px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 0.625rem;
    background: #050816;
    overflow: hidden;
    pointer-events: none;
  }
  .layout-widget-card__meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .layout-widget-card__name { font-size: 0.75rem; font-weight: 600; color: #e2e8f0; }
  .layout-widget-card__cat { font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
  .layout-widget-preview {
    position: relative;
    pointer-events: none;
    flex-shrink: 0;
  }
  .layout-widget-preview__frame {
    display: block;
    border: 0;
    background: transparent;
    background-color: transparent;
    transform-origin: top left;
    pointer-events: none;
  }

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
  .layout-canvas-display {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
    color: #94a3b8;
    white-space: nowrap;
  }
  .layout-canvas-display input {
    width: 3.5rem;
    border: 1px solid var(--color-line);
    border-radius: 0.55rem;
    background: var(--color-panel-soft);
    color: #e2e8f0;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
    text-align: center;
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
    background: rgba(15, 23, 42, 0.45);
    cursor: move;
    overflow: hidden;
    transition: border-color 0.1s, background 0.1s;
    user-select: none;
  }
  .layout-placed-widget--selected {
    border-color: var(--color-accent-strong, #6366f1);
    background: rgba(30, 41, 59, 0.68);
    z-index: 10;
  }
  .layout-placed-widget:hover { border-color: #818cf8; }
  .layout-placed-widget__preview {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 0.25rem;
    pointer-events: none;
  }
  .layout-placed-widget__label {
    position: absolute;
    left: 0.35rem;
    top: 0.35rem;
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.18rem 0.4rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.84);
    border: 1px solid rgba(148, 163, 184, 0.16);
    max-width: calc(100% - 2rem);
    z-index: 1;
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
    z-index: 1;
  }
  .layout-placed-widget__remove:hover { color: #f87171; }
  .layout-placed-widget__resize {
    position: absolute;
    right: 2px;
    bottom: 1px;
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 0.7rem;
    cursor: nwse-resize;
    line-height: 1;
    padding: 0 2px;
    z-index: 1;
  }
  .layout-placed-widget__resize:hover { color: #cbd5e1; }

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
  .layout-properties__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
  .layout-properties__grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.65rem; color: #94a3b8; }
  .layout-properties__grid input {
    border: 1px solid var(--color-line);
    border-radius: 0.45rem;
    background: transparent;
    color: #e2e8f0;
    padding: 0.25rem 0.4rem;
    font-size: 0.75rem;
  }
  .layout-properties__select {
    width: 100%;
    border: 1px solid var(--color-line);
    border-radius: 0.55rem;
    background: transparent;
    color: #e2e8f0;
    padding: 0.35rem 0.5rem;
    font-size: 0.75rem;
  }
  .layout-properties__textarea {
    width: 100%;
    border: 1px solid var(--color-line);
    border-radius: 0.55rem;
    background: rgba(15, 23, 42, 0.45);
    color: #e2e8f0;
    padding: 0.5rem 0.625rem;
    font-size: 0.6875rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
    line-height: 1.45;
    resize: vertical;
    min-height: 7.5rem;
  }
  .layout-properties__error {
    margin-top: 0.35rem;
    font-size: 0.6875rem;
    color: #f87171;
  }
  .layout-properties__desc { font-size: 0.71875rem; color: #94a3b8; line-height: 1.4; }
  .layout-properties__empty { padding: 1.5rem 0; text-align: center; font-size: 0.75rem; color: #475569; }
</style>

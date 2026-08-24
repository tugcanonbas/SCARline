<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import ParticipantLayoutCanvas from "$lib/components/admin/participant-view/ParticipantLayoutCanvas.svelte";
  import ParticipantLayoutCatalogue from "$lib/components/admin/participant-view/ParticipantLayoutCatalogue.svelte";
  import ParticipantLayoutInspector from "$lib/components/admin/participant-view/ParticipantLayoutInspector.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StudyTabs from "$lib/components/StudyTabs.svelte";
  import { appPath } from "$lib/paths";
  import { Database } from "lucide-svelte";

  // Route-level regression markers preserved for source-inspection tests:
  // Bindings Config, Trigger Rules, Style Overrides, Launch Selected Mode,
  // Close All Widgets, Assigned Display, Target display, layout-widget-preview__frame, sandbox="allow-scripts"

  let { data } = $props();
  const apiBase = "/api";
  const currentLayout = $derived(
    (data.participantLayout as Record<string, unknown> | null) ??
      (data.layouts[0] as Record<string, unknown> | null) ??
      null,
  );

  // ─── Types ──────────────────────────────────────────────────────────────────
  type WidgetMeta = {
    id: string;
    name: string;
    category: string;
    description?: string;
    ui?: {
      preferredWidth?: number;
      preferredHeight?: number;
      minWidth?: number;
      minHeight?: number;
    };
  };
  type PreviewMetrics = {
    frameWidth: number;
    frameHeight: number;
    scale: number;
    width: number;
    height: number;
  };
  type OverlayDisplay = {
    index: number;
    id: string;
    label?: string;
    isPrimary: boolean;
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    rotation?: number;
    physicalSize: { width: number; height: number };
  };
  type PlacedWidget = {
    id: string;
    widgetId: string;
    windowMode: "transparent_electron" | "browser_popup";
    targetDisplay: string;
    order: number;
    x: number;
    y: number;
    w: number;
    h: number;
    bindingsConfig: Record<string, unknown>;
    triggerRules: unknown[];
    styleOverrides: Record<string, unknown>;
  };

  const CANVAS_MAX_W = 1040;
  const CANVAS_MAX_H = 640;
  const FALLBACK_DISPLAY: OverlayDisplay = {
    index: 0,
    id: "fallback-0",
    label: "Fallback Display",
    isPrimary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    physicalSize: { width: 1920, height: 1080 },
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  let initializedLayoutId = $state("");
  let layoutName = $state("Primary Participant Layout");
  let placed = $state<PlacedWidget[]>([]);
  let selectedId = $state<string | null>(null);
  let draggingWidgetId = $state<string | null>(null); // catalogue widget id being dragged in
  let canvasEl = $state<HTMLDivElement | null>(null);
  let searchQuery = $state("");
  let activeCategory = $state("all");
  let saving = $state(false);
  let saveResult = $state<{ ok: boolean; message: string } | null>(null);
  let targetDisplay = $state("0");
  let launchMode = $state<"transparent_electron" | "browser_popup">(
    "transparent_electron",
  );
  let selectedEditorId = $state<string | null>(null);
  let bindingsDraft = $state("{}");
  let triggerRulesDraft = $state("[]");
  let styleOverridesDraft = $state("{}");
  let bindingsError = $state<string | null>(null);
  let triggerRulesError = $state<string | null>(null);
  let styleOverridesError = $state<string | null>(null);
  let displayFallbackNotice = $state<string | null>(null);

  function normalizeRect(value: unknown, fallback: OverlayDisplay["bounds"]) {
    const rect =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    return {
      x: Number.isFinite(Number(rect.x)) ? Number(rect.x) : fallback.x,
      y: Number.isFinite(Number(rect.y)) ? Number(rect.y) : fallback.y,
      width: Number.isFinite(Number(rect.width))
        ? Math.max(1, Number(rect.width))
        : fallback.width,
      height: Number.isFinite(Number(rect.height))
        ? Math.max(1, Number(rect.height))
        : fallback.height,
    };
  }

  function normalizeDisplay(value: unknown, index: number): OverlayDisplay {
    const display =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const bounds = normalizeRect(display.bounds, FALLBACK_DISPLAY.bounds);
    const workArea = normalizeRect(display.workArea, bounds);
    const physicalSize = normalizeRect(display.physicalSize, {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
    return {
      index: Number.isFinite(Number(display.index))
        ? Number(display.index)
        : index,
      id: String(display.id ?? `display-${index}`),
      label:
        typeof display.label === "string" ? display.label : `Display ${index}`,
      isPrimary: display.isPrimary === true,
      bounds,
      workArea,
      scaleFactor: Number.isFinite(Number(display.scaleFactor))
        ? Number(display.scaleFactor)
        : 1,
      rotation: Number.isFinite(Number(display.rotation))
        ? Number(display.rotation)
        : 0,
      physicalSize: { width: physicalSize.width, height: physicalSize.height },
    };
  }

  const overlayDisplayPayload = $derived(
    (data.overlayDisplays as Record<string, unknown> | null) ?? null,
  );
  const detectedDisplays = $derived(
    Array.isArray(overlayDisplayPayload?.displays) &&
      overlayDisplayPayload.displays.length > 0
      ? overlayDisplayPayload.displays.map((display: unknown, index: number) =>
          normalizeDisplay(display, index),
        )
      : [FALLBACK_DISPLAY],
  );
  const usingFallbackDisplay = $derived(
    Boolean(overlayDisplayPayload?.fallback) ||
      detectedDisplays[0]?.id === FALLBACK_DISPLAY.id,
  );
  const selectedDisplay = $derived(
    detectedDisplays.find(
      (display) => display.index === Number(targetDisplay),
    ) ??
      detectedDisplays.find((display) => display.isPrimary) ??
      detectedDisplays[0] ??
      FALLBACK_DISPLAY,
  );
  const displayTopology = $derived.by(() => {
    const rects =
      detectedDisplays.length > 0
        ? detectedDisplays.map((display) => display.bounds)
        : [FALLBACK_DISPLAY.bounds];
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(1, CANVAS_MAX_W / width, CANVAS_MAX_H / height);
    return { minX, minY, width, height, scale };
  });
  const canvasScale = $derived(displayTopology.scale);
  const CANVAS_W = $derived(
    Math.max(1, Math.round(displayTopology.width * canvasScale)),
  );
  const CANVAS_H = $derived(
    Math.max(1, Math.round(displayTopology.height * canvasScale)),
  );
  const displayCanvasRects = $derived(
    detectedDisplays.map((display) => ({
      index: display.index,
      id: display.id,
      label: display.label,
      isPrimary: display.isPrimary,
      selected: display.index === selectedDisplay.index,
      x: toCanvas(display.bounds.x - displayTopology.minX),
      y: toCanvas(display.bounds.y - displayTopology.minY),
      width: toCanvas(display.bounds.width),
      height: toCanvas(display.bounds.height),
      sourceX: display.bounds.x,
      sourceY: display.bounds.y,
      sourceWidth: display.bounds.width,
      sourceHeight: display.bounds.height,
    })),
  );
  const displayHint = $derived(
    `${selectedDisplay.bounds.width}×${selectedDisplay.bounds.height} @ ${selectedDisplay.bounds.x},${selectedDisplay.bounds.y}`,
  );
  const topologyHint = $derived(
    `${detectedDisplays.length} screen${detectedDisplays.length === 1 ? "" : "s"} · ${displayTopology.width}×${displayTopology.height} workspace`,
  );

  function toCanvas(value: number) {
    return Math.round(value * canvasScale);
  }

  function fromCanvas(value: number) {
    return Math.round(value / Math.max(0.01, canvasScale));
  }

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function widgetMinimumSize(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return {
      width: Math.max(1, Number(meta?.ui?.minWidth ?? 100)),
      height: Math.max(1, Number(meta?.ui?.minHeight ?? 100)),
    };
  }

  function displayForIndex(index: string | number) {
    return (
      detectedDisplays.find((display) => display.index === Number(index)) ??
      selectedDisplay ??
      FALLBACK_DISPLAY
    );
  }

  function displayBoundsForWidget(widget: PlacedWidget) {
    return displayForIndex(widget.targetDisplay).bounds;
  }

  function displayAtGlobalPoint(globalX: number, globalY: number) {
    const containing = detectedDisplays.find((display) => {
      const bounds = display.bounds;
      return (
        globalX >= bounds.x &&
        globalX <= bounds.x + bounds.width &&
        globalY >= bounds.y &&
        globalY <= bounds.y + bounds.height
      );
    });
    if (containing) return containing;

    return (
      [...detectedDisplays].sort((left, right) => {
        const leftDistance = distanceToDisplay(globalX, globalY, left);
        const rightDistance = distanceToDisplay(globalX, globalY, right);
        return leftDistance - rightDistance;
      })[0] ??
      selectedDisplay ??
      FALLBACK_DISPLAY
    );
  }

  function distanceToDisplay(
    globalX: number,
    globalY: number,
    display: OverlayDisplay,
  ) {
    const bounds = display.bounds;
    const dx = Math.max(
      bounds.x - globalX,
      0,
      globalX - (bounds.x + bounds.width),
    );
    const dy = Math.max(
      bounds.y - globalY,
      0,
      globalY - (bounds.y + bounds.height),
    );
    return Math.hypot(dx, dy);
  }

  function clampWidgetToDisplay(
    widget: PlacedWidget,
    displayIndex = widget.targetDisplay,
  ): PlacedWidget {
    const bounds = displayForIndex(displayIndex).bounds;
    const minSize = widgetMinimumSize(widget.widgetId);
    const width = clamp(
      Math.round(widget.w),
      minSize.width,
      Math.max(minSize.width, bounds.width),
    );
    const height = clamp(
      Math.round(widget.h),
      minSize.height,
      Math.max(minSize.height, bounds.height),
    );
    return {
      ...widget,
      targetDisplay: String(displayIndex),
      x: clamp(Math.round(widget.x), 0, Math.max(0, bounds.width - width)),
      y: clamp(Math.round(widget.y), 0, Math.max(0, bounds.height - height)),
      w: width,
      h: height,
    };
  }

  function placedForCanvas(widget: PlacedWidget) {
    const display = displayForIndex(widget.targetDisplay);
    return {
      ...widget,
      x: toCanvas(display.bounds.x - displayTopology.minX + widget.x),
      y: toCanvas(display.bounds.y - displayTopology.minY + widget.y),
      w: toCanvas(widget.w),
      h: toCanvas(widget.h),
    };
  }

  const placedOnSelectedDisplay = $derived(
    placed.filter(
      (widget) => Number(widget.targetDisplay) === selectedDisplay.index,
    ),
  );
  const placedCanvas = $derived(
    placed.map((widget) => placedForCanvas(widget)),
  );

  function getWidgetOverlayUrl(
    layoutId: string,
    instanceId: string,
    mode: "transparent_electron" | "browser_popup",
  ) {
    const url = new URL(`${window.location.origin}/overlay/${layoutId}`);
    url.searchParams.set("studyId", data.studyId as string);
    url.searchParams.set("layoutId", layoutId);
    url.searchParams.set("instanceId", instanceId);
    url.searchParams.set(
      "chrome",
      mode === "transparent_electron" ? "transparent" : "web",
    );
    url.searchParams.set("toolbar", mode === "browser_popup" ? "1" : "0");
    if (data.accessToken)
      url.searchParams.set("token", data.accessToken as string);
    return url.toString();
  }

  function getWidgetPreviewUrl(widgetId: string) {
    return `/overlay/assets/${widgetId}/index.html?preview=admin`;
  }

  function relativeBounds(widget: PlacedWidget) {
    return {
      x: Math.round(widget.x),
      y: Math.round(widget.y),
      width: Math.round(widget.w),
      height: Math.round(widget.h),
    };
  }

  function absoluteBounds(widget: PlacedWidget) {
    const relative = relativeBounds(widget);
    const display = displayForIndex(widget.targetDisplay);
    return {
      ...relative,
      x: display.bounds.x + relative.x,
      y: display.bounds.y + relative.y,
    };
  }

  function launchPriority(left: PlacedWidget, right: PlacedWidget) {
    return left.order - right.order || left.y - right.y || left.x - right.x;
  }

  async function openOverlayWindow(
    layoutId: string,
    widget: PlacedWidget,
    mode: "transparent_electron" | "browser_popup" = widget.windowMode,
  ) {
    const meta = getWidgetMeta(widget.widgetId);
    const targetDisplayValue = displayForIndex(widget.targetDisplay).index;
    const bounds = absoluteBounds(widget);
    const response = await fetch(`${apiBase}/system/overlay/windows/open`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.accessToken as string}`,
      },
      body: JSON.stringify({
        studyId: data.studyId as string,
        layoutId,
        instanceId: widget.id,
        mode,
        targetDisplay: targetDisplayValue,
      }),
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const directResponse = await fetch("http://127.0.0.1:4097/windows/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "windows",
        targetDisplay: targetDisplayValue,
        windows: [
          {
            instanceId: widget.id,
            widgetId: widget.widgetId,
            mode,
            clickThrough: false,
            bounds,
            minWidth: meta?.ui?.minWidth ?? bounds.width,
            minHeight: meta?.ui?.minHeight ?? bounds.height,
            preferredWidth: meta?.ui?.preferredWidth ?? bounds.width,
            preferredHeight: meta?.ui?.preferredHeight ?? bounds.height,
            url: getWidgetOverlayUrl(layoutId, widget.id, mode),
          },
        ],
        session: {
          studyId: data.studyId as string,
          sessionId: null,
          layoutId,
          conditionId: null,
        },
      }),
    }).catch(() => null);
    if (!directResponse?.ok) {
      throw new Error(
        payload?.error?.message ||
          "Failed to open Electron widget window. Ensure the desktop overlay control server is running.",
      );
    }
  }

  // ─── Catalogue filtering ────────────────────────────────────────────────────
  const categories = $derived([
    "all",
    ...new Set(
      (data.widgets as WidgetMeta[]).map((w) => w.category).filter(Boolean),
    ),
  ]);

  const filteredWidgets = $derived(
    (data.widgets as WidgetMeta[]).filter((w) => {
      const matchCat =
        activeCategory === "all" || w.category === activeCategory;
      const matchSearch =
        !searchQuery ||
        w.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    }),
  );

  const selectedWidget = $derived(
    placed.find((p) => p.id === selectedId) ?? null,
  );

  function formatJson(value: unknown) {
    return JSON.stringify(value ?? null, null, 2);
  }

  function updateSelectedWidget(
    mutator: (widget: PlacedWidget) => PlacedWidget,
  ) {
    if (!selectedId) return;
    placed = placed.map((widget) =>
      widget.id === selectedId ? mutator(widget) : widget,
    );
  }

  function applyJsonDraft(
    raw: string,
    kind: "object" | "array",
    onValid: (value: Record<string, unknown> | unknown[]) => void,
    onError: (message: string | null) => void,
  ) {
    if (!raw.trim()) {
      const fallback = kind === "array" ? [] : {};
      onValid(fallback);
      onError(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (kind === "array" && !Array.isArray(parsed)) {
        onError("Must be a JSON array");
        return;
      }
      if (
        kind === "object" &&
        (Array.isArray(parsed) || parsed === null || typeof parsed !== "object")
      ) {
        onError("Must be a JSON object");
        return;
      }
      onValid(parsed as Record<string, unknown> | unknown[]);
      onError(null);
    } catch {
      onError("Invalid JSON");
    }
  }

  // ─── Build initial placed widgets from saved layout ─────────────────────────
  function buildInitialPlaced(): PlacedWidget[] {
    const layout = currentLayout as Record<string, unknown> | null;
    if (!layout) return [];
    const widgets = Array.isArray(layout.widgets)
      ? layout.widgets
      : Array.isArray(
            (layout.layoutConfig as Record<string, unknown> | undefined)
              ?.widgets,
          )
        ? ((layout.layoutConfig as Record<string, unknown>).widgets as Array<
            Record<string, unknown>
          >)
        : [];
    return widgets.map((w: Record<string, unknown>, i: number) => ({
      id: String(w.id ?? crypto.randomUUID()),
      widgetId: String(w.widgetId ?? ""),
      windowMode:
        w.windowMode === "browser_popup"
          ? "browser_popup"
          : "transparent_electron",
      targetDisplay: String(
        w.targetDisplay ??
          layout.targetDisplay ??
          currentLayout?.targetDisplay ??
          "0",
      ),
      order: Number(w.order ?? i),
      x: Math.round(Number(w.x ?? 40 + i * 200)),
      y: Math.round(Number(w.y ?? 40)),
      w: Math.round(
        Number(w.width ?? getWidgetBaseSize(String(w.widgetId ?? "")).width),
      ),
      h: Math.round(
        Number(w.height ?? getWidgetBaseSize(String(w.widgetId ?? "")).height),
      ),
      bindingsConfig: (w.bindingsConfig as Record<string, unknown>) ?? {},
      triggerRules: (w.triggerRules as unknown[]) ?? [],
      styleOverrides: (w.styleOverrides as Record<string, unknown>) ?? {},
    }));
  }

  $effect(() => {
    const nextLayoutId = String(currentLayout?.id ?? "new");
    if (initializedLayoutId !== nextLayoutId) {
      layoutName =
        (currentLayout?.name as string) ?? "Primary Participant Layout";
      targetDisplay = String(currentLayout?.targetDisplay ?? "0");
      placed = buildInitialPlaced();
      selectedId = null;
      initializedLayoutId = nextLayoutId;
    }
  });

  $effect(() => {
    if (detectedDisplays.length === 0) return;
    const exists = detectedDisplays.some(
      (display) => display.index === Number(targetDisplay),
    );
    if (!exists) {
      const previousDisplay = targetDisplay;
      const fallback =
        detectedDisplays.find((display) => display.isPrimary) ??
        detectedDisplays[0];
      targetDisplay = String(fallback.index);
      displayFallbackNotice = `Saved display #${previousDisplay} is unavailable. Participant View is using display #${fallback.index}.`;
    } else {
      displayFallbackNotice = null;
    }
  });

  $effect(() => {
    if (!selectedWidget) {
      selectedEditorId = null;
      bindingsDraft = "{}";
      triggerRulesDraft = "[]";
      styleOverridesDraft = "{}";
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
      height: Math.max(
        1,
        meta?.ui?.preferredHeight ?? meta?.ui?.minHeight ?? 180,
      ),
    };
  }
  function getPreviewMetrics(
    widgetId: string,
    maxWidth: number,
    maxHeight: number,
  ): PreviewMetrics {
    const base = getWidgetBaseSize(widgetId);
    const safeWidth = Math.max(1, maxWidth);
    const safeHeight = Math.max(1, maxHeight);
    const scale = Math.max(
      0.05,
      Math.min(safeWidth / base.width, safeHeight / base.height),
    );
    return {
      frameWidth: base.width,
      frameHeight: base.height,
      scale,
      width: Math.max(1, Math.round(base.width * scale)),
      height: Math.max(1, Math.round(base.height * scale)),
    };
  }
  function getPreferredWidth(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return Math.round(meta?.ui?.preferredWidth ?? meta?.ui?.minWidth ?? 180);
  }
  function getPreferredHeight(widgetId: string) {
    const meta = getWidgetMeta(widgetId);
    return Math.round(meta?.ui?.preferredHeight ?? meta?.ui?.minHeight ?? 180);
  }

  // ─── Drag widget from catalogue onto canvas ──────────────────────────────────
  function onCatalogueDragStart(e: DragEvent, widgetId: string) {
    draggingWidgetId = widgetId;
    e.dataTransfer!.effectAllowed = "copy";
    e.dataTransfer!.setData("text/plain", widgetId);
  }

  function onCanvasDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  }

  function onCanvasDrop(e: DragEvent) {
    e.preventDefault();
    if (!draggingWidgetId || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const w = getPreferredWidth(draggingWidgetId);
    const h = getPreferredHeight(draggingWidgetId);
    const globalX = fromCanvas(e.clientX - rect.left) + displayTopology.minX;
    const globalY = fromCanvas(e.clientY - rect.top) + displayTopology.minY;
    const display = displayAtGlobalPoint(globalX, globalY);
    const x = clamp(
      Math.round(globalX - display.bounds.x) - Math.round(w / 2),
      0,
      Math.max(0, display.bounds.width - w),
    );
    const y = clamp(
      Math.round(globalY - display.bounds.y) - Math.round(h / 2),
      0,
      Math.max(0, display.bounds.height - h),
    );
    placed = [
      ...placed,
      {
        id: crypto.randomUUID(),
        widgetId: draggingWidgetId,
        windowMode: "transparent_electron",
        targetDisplay: String(display.index),
        order: placed.length,
        x,
        y,
        w,
        h,
        bindingsConfig: {},
        triggerRules: [],
        styleOverrides: {},
      },
    ];
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
    targetDisplay = String(widget.targetDisplay);
    dragOffset = { x: fromCanvas(e.offsetX), y: fromCanvas(e.offsetY) };
    const onMove = (me: MouseEvent) => {
      if (!canvasEl || !draggingPlacedId) return;
      const rect = canvasEl.getBoundingClientRect();
      placed = placed.map((p) =>
        p.id === id
          ? (() => {
              const globalX =
                fromCanvas(me.clientX - rect.left) +
                displayTopology.minX -
                dragOffset.x;
              const globalY =
                fromCanvas(me.clientY - rect.top) +
                displayTopology.minY -
                dragOffset.y;
              const display = displayAtGlobalPoint(
                globalX + Math.round(p.w / 2),
                globalY + Math.round(p.h / 2),
              );
              targetDisplay = String(display.index);
              return {
                ...p,
                targetDisplay: String(display.index),
                x: clamp(
                  Math.round(globalX - display.bounds.x),
                  0,
                  Math.max(0, display.bounds.width - p.w),
                ),
                y: clamp(
                  Math.round(globalY - display.bounds.y),
                  0,
                  Math.max(0, display.bounds.height - p.h),
                ),
              };
            })()
          : p,
      );
    };
    const onUp = () => {
      draggingPlacedId = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
    const minSize = widgetMinimumSize(widget.widgetId);

    const onMove = (me: MouseEvent) => {
      const bounds = displayBoundsForWidget(widget);
      const nextW = clamp(
        startW + fromCanvas(me.clientX - startX),
        minSize.width,
        Math.max(minSize.width, bounds.width - widget.x),
      );
      const nextH = clamp(
        startH + fromCanvas(me.clientY - startY),
        minSize.height,
        Math.max(minSize.height, bounds.height - widget.y),
      );
      placed = placed.map((p) =>
        p.id === id ? { ...p, w: Math.round(nextW), h: Math.round(nextH) } : p,
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ─── Save layout ─────────────────────────────────────────────────────────────
  async function saveLayout() {
    saving = true;
    saveResult = null;
    try {
      const layoutId = await persistLayout();
      saveResult = {
        ok: true,
        message: `Layout saved (${layoutId.slice(0, 8)})`,
      };
    } catch (error) {
      saveResult = {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to save layout",
      };
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
        targetDisplay: p.targetDisplay,
        order: i,
        x: Math.round(p.x),
        y: Math.round(p.y),
        width: Math.round(p.w),
        height: Math.round(p.h),
        bindingsConfig: p.bindingsConfig,
        triggerRules: p.triggerRules,
        styleOverrides: p.styleOverrides,
      })),
    };
  }

  async function persistLayout(): Promise<string> {
    if (!data.accessToken) {
      throw new Error("No access token available");
    }

    const payload = {
      ...buildLayoutPayload(),
      name: layoutName,
      type: "participant",
      targetDisplay,
      studyId: data.studyId as string,
    };

    const layoutsResponse = await fetch(
      `${apiBase}/studies/${data.studyId}/layouts`,
      {
        headers: {
          authorization: `Bearer ${data.accessToken as string}`,
        },
      },
    );
    if (!layoutsResponse.ok) {
      throw new Error("Failed to query study layouts");
    }
    const layoutsPayload = await layoutsResponse.json().catch(() => null);
    const existing =
      (layoutsPayload?.data ?? []).find(
        (entry: Record<string, unknown>) => entry.type === "participant",
      ) ??
      layoutsPayload?.data?.[0] ??
      null;

    if (existing?.id) {
      const response = await fetch(
        `${apiBase}/studies/${data.studyId}/layouts/${existing.id}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${data.accessToken as string}`,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to update participant layout");
      }
      return String(existing.id);
    }

    const response = await fetch(`${apiBase}/studies/${data.studyId}/layouts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.accessToken as string}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to create participant layout");
    }
    const created = await response.json().catch(() => null);
    const layoutId = String(created?.data?.id ?? "");
    if (!layoutId) {
      throw new Error("Participant layout created without id");
    }
    return layoutId;
  }

  async function launchSelectedMode() {
    const targets = [...placed].sort(launchPriority);
    if (targets.length === 0) {
      saveResult = {
        ok: false,
        message: "Add at least one widget before launching",
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
          console.error("Failed to launch overlay widget", widget.id, error);
        }
      }

      if (launchMode === "browser_popup") {
        saveResult =
          opened > 0
            ? { ok: true, message: `Opened ${opened} browser widget window(s)` }
            : { ok: false, message: "Failed to open browser widget windows" };
        return;
      }

      saveResult =
        opened > 0
          ? {
              ok: true,
              message: `Opened ${opened} transparent Electron widget window(s)`,
            }
          : {
              ok: false,
              message: "Failed to open transparent Electron widget windows",
            };
    } catch (error) {
      saveResult = {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to launch layout",
      };
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
        message:
          widget.windowMode === "browser_popup"
            ? "Browser widget window opened"
            : "Electron widget window opened",
      };
    } catch (error) {
      saveResult = {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to open widget window",
      };
    }
  }

  async function closeOverlayWindows(options: {
    instanceIds?: string[];
    closeAll?: boolean;
  }) {
    const layoutId = String(currentLayout?.id ?? "");
    const body = {
      studyId: data.studyId as string,
      ...(layoutId ? { layoutId } : {}),
      instanceIds: options.instanceIds ?? [],
      closeAll: options.closeAll === true,
    };
    const response = await fetch(`${apiBase}/system/overlay/windows/close`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.accessToken as string}`,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null);
    const directResponse = await fetch("http://127.0.0.1:4097/windows/close", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        layoutId: layoutId || undefined,
        instanceIds: body.instanceIds,
        closeAll: body.closeAll,
      }),
    }).catch(() => null);
    if (!directResponse?.ok) {
      throw new Error(
        payload?.error?.message ||
          "Failed to close widget window. Ensure the desktop overlay control server is running.",
      );
    }
  }

  async function closePlacedWidgetWindow(id: string) {
    try {
      await closeOverlayWindows({ instanceIds: [id] });
      saveResult = { ok: true, message: "Widget window closed" };
    } catch (error) {
      saveResult = {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to close widget window",
      };
    }
  }

  async function closeSelectedWidgetWindow() {
    if (!selectedWidget) return;
    await closePlacedWidgetWindow(selectedWidget.id);
  }

  async function closeAllWidgetWindows() {
    try {
      await closeOverlayWindows({ closeAll: true });
      saveResult = { ok: true, message: "All widget windows closed" };
    } catch (error) {
      saveResult = {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to close widget windows",
      };
    }
  }

  function handleInspectorPosition(axis: "x" | "y", value: number) {
    updateSelectedWidget((widget) => ({
      ...widget,
      [axis]: clamp(
        Math.round(value),
        0,
        Math.max(
          0,
          axis === "x"
            ? displayBoundsForWidget(widget).width - widget.w
            : displayBoundsForWidget(widget).height - widget.h,
        ),
      ),
    }));
  }

  function handleInspectorSize(axis: "w" | "h", value: number) {
    updateSelectedWidget((widget) => ({
      ...widget,
      [axis]: clamp(
        Math.round(value),
        axis === "w"
          ? widgetMinimumSize(widget.widgetId).width
          : widgetMinimumSize(widget.widgetId).height,
        axis === "w"
          ? displayBoundsForWidget(widget).width - widget.x
          : displayBoundsForWidget(widget).height - widget.y,
      ),
    }));
  }

  function handleWidgetDisplayChange(displayIndex: string) {
    updateSelectedWidget((widget) =>
      clampWidgetToDisplay(widget, displayIndex),
    );
    targetDisplay = String(displayIndex);
  }

  function handleBindingsInput(value: string) {
    bindingsDraft = value;
    applyJsonDraft(
      value,
      "object",
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
      "array",
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
      "object",
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
  current={`/user-studies/${data.studyId}/participant-view`}
/>

<div class="metric-grid">
  <MetricCard
    label="Placed Widgets"
    value={placed.length}
    hint={`${placedOnSelectedDisplay.length} on selected display`}
  />
  <MetricCard
    label="Catalogue"
    value={data.widgets.length}
    hint="Available widgets"
  />
  <MetricCard
    label="Saved Layouts"
    value={data.layouts.length}
    hint="Persisted layout records"
  />
  <MetricCard
    label="Screens"
    value={detectedDisplays.length}
    hint={usingFallbackDisplay ? "Fallback display · 1920×1080" : topologyHint}
  />
</div>

{#if saveResult}
  <div class="mt-4">
    <InlineNotice
      tone={saveResult.ok ? "success" : "danger"}
      message={saveResult.message}
    />
  </div>
{/if}

{#if usingFallbackDisplay}
  <div class="mt-4">
    <InlineNotice
      tone="warning"
      message="Display detection is unavailable. Participant View is using the fallback 1920×1080 display until the desktop overlay reports connected screens."
    />
  </div>
{/if}

{#if displayFallbackNotice}
  <div class="mt-4">
    <InlineNotice tone="warning" message={displayFallbackNotice} />
  </div>
{/if}

<div class="layout-editor-shell">
  <ParticipantLayoutCatalogue
    bind:searchQuery
    bind:activeCategory
    {categories}
    {filteredWidgets}
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
    displayWidth={selectedDisplay.bounds.width}
    displayHeight={selectedDisplay.bounds.height}
    displays={detectedDisplays}
    selectedDisplayIndex={selectedDisplay.index}
    {usingFallbackDisplay}
    displayRects={displayCanvasRects}
    {topologyHint}
    selectedDisplayHint={displayHint}
    {saving}
    placed={placedCanvas}
    {getWidgetMeta}
    {getPreviewMetrics}
    {getWidgetPreviewUrl}
    {onCanvasDragOver}
    {onCanvasDrop}
    {onPlacedMouseDown}
    {onResizeHandleMouseDown}
    onRemovePlaced={removePlaced}
    onClosePlaced={closePlacedWidgetWindow}
    onLaunchSelectedMode={launchSelectedMode}
    onCloseAllWidgets={closeAllWidgetWindows}
    onSaveLayout={saveLayout}
  />

  <ParticipantLayoutInspector
    {selectedWidget}
    {getWidgetMeta}
    displays={detectedDisplays}
    displayX={selectedWidget ? Math.round(selectedWidget.x) : 0}
    displayY={selectedWidget ? Math.round(selectedWidget.y) : 0}
    displayW={selectedWidget ? Math.round(selectedWidget.w) : 0}
    displayH={selectedWidget ? Math.round(selectedWidget.h) : 0}
    {bindingsDraft}
    {triggerRulesDraft}
    {styleOverridesDraft}
    {bindingsError}
    {triggerRulesError}
    {styleOverridesError}
    onPositionInput={handleInspectorPosition}
    onSizeInput={handleInspectorSize}
    onDisplayChange={handleWidgetDisplayChange}
    onModeChange={(mode) =>
      updateSelectedWidget((widget) => ({ ...widget, windowMode: mode }))}
    onBindingsInput={handleBindingsInput}
    onTriggerRulesInput={handleTriggerRulesInput}
    onStyleOverridesInput={handleStyleOverridesInput}
    onOpenSelectedWidgetWindow={openSelectedWidgetWindow}
    onCloseSelectedWidgetWindow={closeSelectedWidgetWindow}
  />
</div>

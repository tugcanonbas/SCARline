<script lang="ts">
  let {
    searchQuery = $bindable(''),
    activeCategory = $bindable('all'),
    categories = [],
    filteredWidgets = [],
    getPreviewMetrics,
    getWidgetPreviewUrl,
    onWidgetDragStart
  } = $props<{
    searchQuery?: string;
    activeCategory?: string;
    categories: string[];
    filteredWidgets: Array<Record<string, unknown>>;
    getPreviewMetrics: (widgetId: string, maxWidth: number, maxHeight: number) => {
      frameWidth: number;
      frameHeight: number;
      scale: number;
      width: number;
      height: number;
    };
    getWidgetPreviewUrl: (widgetId: string) => string;
    onWidgetDragStart: (event: DragEvent, widgetId: string) => void;
  }>();
</script>

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
          class={`layout-cat-btn ${activeCategory === cat ? 'layout-cat-btn--active' : ''}`}
          onclick={() => (activeCategory = cat)}
          type="button"
        >
          {cat}
        </button>
      {/each}
    </div>
  </div>
  <div class="layout-catalogue__list">
    {#each filteredWidgets as widget}
      {@const preview = getPreviewMetrics(String(widget.id), 172, 102)}
      <div
        class="layout-widget-card"
        draggable="true"
        ondragstart={(event) => onWidgetDragStart(event, String(widget.id))}
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
              src={getWidgetPreviewUrl(String(widget.id))}
              style={`width:${preview.frameWidth}px;height:${preview.frameHeight}px;transform:scale(${preview.scale});`}
              title={`${String(widget.name ?? widget.id)} preview`}
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

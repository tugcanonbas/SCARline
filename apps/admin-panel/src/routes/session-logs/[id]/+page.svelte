<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  type SessionEvent = {
    eventType?: string;
    timestamp?: string;
    source?: string;
    modality?: string;
    routingKey?: string;
    payload?: Record<string, unknown>;
  };

  const events = $derived(data.events as SessionEvent[]);
  const sources = $derived(new Set(events.map((e) => String(e.source ?? 'unknown'))).size);

  // ─── Filter state ──────────────────────────────────────────────────────────
  const modalityColors: Record<string, string> = {
    telemetry: '#818cf8',
    trigger: '#34d399',
    sensor: '#fb923c',
    lifecycle: '#94a3b8',
    unknown: '#475569'
  };

  const allModalities = $derived([
    'all',
    ...new Set(events.map((e) => String(e.modality ?? 'unknown')))
  ]);
  let filterModality = $state('all');
  let searchFilter = $state('');

  const filteredEvents = $derived(
    events.filter((e) => {
      const matchMod = filterModality === 'all' || String(e.modality ?? 'unknown') === filterModality;
      const matchSearch = !searchFilter || JSON.stringify(e).toLowerCase().includes(searchFilter.toLowerCase());
      return matchMod && matchSearch;
    })
  );

  // ─── Timeline computation ─────────────────────────────────────────────────
  const timelineEvents = $derived(() => {
    if (events.length < 2) return [];
    const timestamps = events
      .map((e) => e.timestamp ? new Date(e.timestamp).getTime() : null)
      .filter((t): t is number => t !== null);
    if (timestamps.length < 2) return [];
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    const range = Math.max(maxT - minT, 1);
    return events
      .filter((e) => e.timestamp)
      .map((e) => {
        const t = new Date(e.timestamp!).getTime();
        const pct = ((t - minT) / range) * 100;
        const mod = String(e.modality ?? 'unknown');
        return { pct, mod, color: modalityColors[mod] ?? '#475569', label: String(e.eventType ?? '?') };
      });
  });

  const duration = $derived(data.summary.durationSeconds ?? 0);
  const durationLabel = $derived(
    duration >= 60
      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
      : `${duration}s`
  );

  function eventType(event: SessionEvent) { return String(event.eventType ?? 'event'); }
  function eventSource(event: SessionEvent) { return String(event.source ?? 'unknown'); }
  function eventPayload(event: SessionEvent) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return Object.entries(payload).map(([label, value]) => ({ label, value }));
  }

  function modalityColor(mod: string) {
    return modalityColors[mod] ?? '#475569';
  }

  // ─── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['eventType', 'timestamp', 'source', 'modality', 'routingKey'];
    const rows = filteredEvents.map((e) =>
      headers.map((h) => JSON.stringify(String((e as Record<string, unknown>)[h] ?? ''))).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${data.sessionId}-events.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<PageHeader
  eyebrow="Evidence"
  title="Session Log Detail"
  description={`Event timeline, summary statistics, and filtered event stream for session ${data.sessionId}.`}
/>

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Status</p>
    <p class="metric-card__value">{data.summary.status}</p>
    <p class="metric-card__hint">Session lifecycle state</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Events</p>
    <p class="metric-card__value">{data.summary.eventCount}</p>
    <p class="metric-card__hint">Persisted event records</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Modalities</p>
    <p class="metric-card__value">{data.summary.modalityCount}</p>
    <p class="metric-card__hint">{sources} event sources</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Duration</p>
    <p class="metric-card__value">{durationLabel}</p>
    <p class="metric-card__hint">Session elapsed time</p>
  </div>
</div>

<!-- ── Timeline visualization ─────────────────────────────────────────────── -->
<div class="mt-4">
  <SurfaceCard title="Event Timeline" subtitle="Chronological event distribution mapped across session duration. Color = modality.">
    <!-- Legend -->
    <div class="timeline-legend">
      {#each Object.entries(modalityColors) as [mod, color]}
        <div class="timeline-legend-item">
          <span class="timeline-legend-dot" style="background:{color}"></span>
          <span>{mod}</span>
        </div>
      {/each}
    </div>

    <!-- Timeline bar -->
    {#if timelineEvents().length > 0}
      <div class="timeline-bar">
        <div class="timeline-bar__track">
          {#each timelineEvents() as evt}
            <div
              class="timeline-bar__tick"
              style="left:{evt.pct.toFixed(2)}%;background:{evt.color}"
              title="{evt.label} ({evt.mod})"
            ></div>
          {/each}
        </div>
        <div class="timeline-bar__labels">
          <span>0s</span>
          <span>{durationLabel}</span>
        </div>
      </div>
    {:else}
      <div class="timeline-bar-empty">
        <p>Insufficient timestamp data to render timeline</p>
      </div>
    {/if}
  </SurfaceCard>
</div>

<!-- ── Event stream ───────────────────────────────────────────────────────── -->
<div class="mt-4">
  <SurfaceCard title="Event Stream" subtitle="Filtered event list with expandable payload detail.">
    <!-- Toolbar -->
    <div class="event-toolbar">
      <form class="flex gap-2" method="GET">
        <input
          class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-2 text-sm"
          min="1"
          max="1000"
          name="limit"
          type="number"
          value={data.limit}
        />
        <button class="rounded-2xl border border-[--color-line] px-4 py-2 text-sm" type="submit">Reload</button>
      </form>
      <div class="flex flex-wrap gap-2">
        {#each allModalities as mod}
          <button
            class="modality-filter-btn {filterModality === mod ? 'modality-filter-btn--active' : ''}"
            style={filterModality === mod && mod !== 'all' ? `border-color:${modalityColor(mod)};color:${modalityColor(mod)}` : ''}
            onclick={() => (filterModality = mod)}
            type="button"
          >{mod}</button>
        {/each}
      </div>
      <div class="flex gap-2 items-center ml-auto">
        <input
          bind:value={searchFilter}
          class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-3 py-2 text-xs"
          placeholder="Search events…"
          type="search"
        />
        <button
          class="rounded-2xl border border-[--color-line] px-3 py-2 text-xs"
          onclick={exportCSV}
          type="button"
        >Export CSV</button>
      </div>
    </div>

    <p class="mt-3 mb-2 text-xs text-slate-500">{filteredEvents.length} events shown</p>

    <div class="timeline-list">
      {#each filteredEvents as event}
        <details class="timeline-entry">
          <summary class="cursor-pointer text-sm font-semibold text-white flex items-center gap-3">
            <span
              class="modality-dot"
              style="background:{modalityColor(String(event.modality ?? 'unknown'))}"
            ></span>
            {eventType(event)}
            <span class="ml-auto text-xs text-slate-500 font-normal">{event.timestamp}</span>
          </summary>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Source</p>
              <p class="mt-1 text-slate-100">{eventSource(event)}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Modality</p>
              <p class="mt-1" style="color:{modalityColor(String(event.modality ?? 'unknown'))}">{event.modality ?? 'unknown'}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Routing Key</p>
              <p class="mt-1 break-words text-slate-100">{event.routingKey ?? 'unknown'}</p>
            </div>
          </div>
          <div class="mt-3">
            <KeyValueGrid items={eventPayload(event)} />
          </div>
        </details>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">
          {filteredEvents.length === 0 && events.length > 0
            ? 'No events match the current filter.'
            : 'This session has no persisted events yet.'}
        </p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<style>
  .timeline-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 0.875rem;
    font-size: 0.6875rem;
    color: #94a3b8;
  }
  .timeline-legend-item { display: flex; align-items: center; gap: 0.35rem; }
  .timeline-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .timeline-bar {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .timeline-bar__track {
    position: relative;
    height: 24px;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--color-line);
    border-radius: 0.375rem;
    overflow: hidden;
  }
  .timeline-bar__tick {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    opacity: 0.75;
    border-radius: 1px;
    transform: translateX(-1px);
  }
  .timeline-bar__tick:hover { opacity: 1; z-index: 10; }
  .timeline-bar__labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.625rem;
    color: #475569;
  }
  .timeline-bar-empty {
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: #475569;
    border: 1px dashed var(--color-line);
    border-radius: 0.375rem;
  }

  .event-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .modality-filter-btn {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: transparent;
    color: #64748b;
    cursor: pointer;
    transition: all 0.1s;
  }
  .modality-filter-btn--active {
    background: rgba(99,102,241,0.1);
    border-color: #6366f1;
    color: #a5b4fc;
  }

  .modality-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>

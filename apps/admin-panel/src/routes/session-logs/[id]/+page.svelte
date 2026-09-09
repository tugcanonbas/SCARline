<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { formatDate, formatStatusLabel } from '$lib/format';
  import { appPath } from '$lib/paths';

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
  <MetricCard label="Status" value={formatStatusLabel(data.summary.status)} hint="Session lifecycle state" accent />
  <MetricCard label="Events" value={data.summary.eventCount} hint="Persisted event records" />
  <MetricCard label="Modalities" value={data.summary.modalityCount} hint={`${sources} event sources`} />
  <MetricCard label="Duration" value={durationLabel} hint="Session elapsed time" />
</div>

<!-- ── Timeline visualization ─────────────────────────────────────────────── -->
<div class="mt-4">
  <SurfaceCard title="Event Timeline" subtitle="Timeline of events during the session. Colors represent different event types.">
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
      <form class="toolbar" method="GET">
        <input
          class="toolbar__grow"
          min="1"
          max="1000"
          name="limit"
          type="number"
          value={data.limit}
        />
        <button class="button-secondary" type="submit">Reload</button>
      </form>
      <div class="pill-row">
        {#each allModalities as mod}
          <button
            class="modality-filter-btn {filterModality === mod ? 'modality-filter-btn--active' : ''}"
            style={filterModality === mod && mod !== 'all' ? `border-color:${modalityColor(mod)};color:${modalityColor(mod)}` : ''}
            onclick={() => (filterModality = mod)}
            type="button"
          >{mod}</button>
        {/each}
      </div>
      <div class="toolbar__end">
        <input
          bind:value={searchFilter}
          class="toolbar__grow"
          placeholder="Search events…"
          type="search"
        />
        <button
          class="button-secondary"
          onclick={exportCSV}
          type="button"
        >Export Visible Events (CSV)</button>
      </div>
    </div>
    <p class="form-field__hint mt-2">
      This only exports the events currently shown above (filtered, this
      device). For the complete session in JSON, CSV, or ZIP, use
      <a href={appPath(`/exports?prefillSessionId=${data.sessionId}`)}>Full Export</a
      >.
    </p>

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
            <span class="ml-auto text-xs text-slate-500 font-normal">{formatDate(event.timestamp)}</span>
          </summary>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div class="detail-panel">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Source</p>
              <p class="mt-1 text-slate-100">{eventSource(event)}</p>
            </div>
            <div class="detail-panel">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Modality</p>
              <p class="mt-1" style="color:{modalityColor(String(event.modality ?? 'unknown'))}">{event.modality ?? 'unknown'}</p>
            </div>
          </div>
          <div class="mt-3">
            <KeyValueGrid items={eventPayload(event)} />
          </div>
        </details>
      {:else}
        <EmptyState
          message={filteredEvents.length === 0 && events.length > 0
            ? 'No events match the current filter.'
            : 'This session has no persisted events yet.'}
        />
      {/each}
    </div>
  </SurfaceCard>
</div>

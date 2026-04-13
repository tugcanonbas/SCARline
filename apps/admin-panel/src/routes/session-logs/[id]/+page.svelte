<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();

  function eventType(event: Record<string, unknown>) {
    return String(event.event_type ?? event.eventType ?? 'event');
  }

  function eventSource(event: Record<string, unknown>) {
    return String(event.source ?? 'unknown');
  }

  function eventPayload(event: Record<string, unknown>) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    return Object.entries(payload).map(([label, value]) => ({ label, value }));
  }
</script>

<PageHeader
  eyebrow="Evidence"
  title="Session Log Detail"
  description={`Persisted event stream and summary statistics for session ${data.sessionId}.`}
/>

<div class="grid gap-4 md:grid-cols-4">
  <SurfaceCard title="Status"><p class="text-2xl font-semibold">{data.summary.status}</p></SurfaceCard>
  <SurfaceCard title="Events"><p class="text-2xl font-semibold">{data.summary.eventCount}</p></SurfaceCard>
  <SurfaceCard title="Modalities"><p class="text-2xl font-semibold">{data.summary.modalityCount}</p></SurfaceCard>
  <SurfaceCard title="Duration"><p class="text-2xl font-semibold">{data.summary.durationSeconds ?? 0}s</p></SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Event Stream">
    <form class="mb-4 flex gap-3" method="GET">
      <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" min="1" max="1000" name="limit" type="number" value={data.limit} />
      <button class="rounded-2xl border border-[--color-line] px-4 py-3 text-sm" type="submit">Reload</button>
    </form>
    <div class="space-y-3">
      {#each data.events as event}
        <details class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <summary class="cursor-pointer text-sm font-semibold text-white">
            {eventType(event)} · {event.timestamp}
          </summary>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Source</p>
              <p class="mt-1 text-slate-100">{eventSource(event)}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Modality</p>
              <p class="mt-1 text-slate-100">{event.modality ?? 'unknown'}</p>
            </div>
            <div class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Routing Key</p>
              <p class="mt-1 break-words text-slate-100">{event.routing_key ?? event.routingKey ?? 'unknown'}</p>
            </div>
          </div>
          <div class="mt-3">
            <KeyValueGrid items={eventPayload(event)} />
          </div>
        </details>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">This session has no persisted events yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

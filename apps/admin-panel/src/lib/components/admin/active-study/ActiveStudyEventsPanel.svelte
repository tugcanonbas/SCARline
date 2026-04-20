<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { events = [], eventTitle, eventTime, selectedSession = '' } = $props<{
    events?: Array<Record<string, unknown>>;
    eventTitle: (event: Record<string, unknown>) => string;
    eventTime: (event: Record<string, unknown>) => string;
    selectedSession?: string;
  }>();
</script>

<SurfaceCard title="Session Events" subtitle="Lifecycle and simulator events for the selected run.">
  <div class="timeline-list">
    {#each events as event}
      <div class="timeline-entry text-sm">
        <div class="toolbar">
          <p class="font-semibold">{eventTitle(event)}</p>
          <span class="entity-card__meta">{eventTime(event)}</span>
        </div>
        <p class="entity-card__meta">Session {event.sessionId ?? selectedSession ?? 'unknown'}</p>
      </div>
    {:else}
      <EmptyState message="Waiting for session lifecycle events." />
    {/each}
  </div>
</SurfaceCard>

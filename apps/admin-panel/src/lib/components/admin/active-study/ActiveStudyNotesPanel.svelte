<script lang="ts">
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let {
    selectedSession = '',
    noteText = $bindable(''),
    onHandleNoteKeydown,
    noteEntries = []
  } = $props<{
    selectedSession?: string;
    noteText?: string;
    onHandleNoteKeydown: (event: KeyboardEvent) => void;
    noteEntries?: Array<{ timestamp: string; text: string }>;
  }>();
</script>

<SurfaceCard title="Operator Notes" subtitle="Timestamped session notes are saved to the selected session.">
  <form class="form-stack" method="POST" action="?/note">
    <input type="hidden" name="sessionId" value={selectedSession} />
    <textarea
      name="note"
      bind:value={noteText}
      class="min-h-20 flex-1 text-sm"
      placeholder="Enter observation and press Add Note…"
      onkeydown={onHandleNoteKeydown}
    ></textarea>
    <button class="button-secondary" disabled={!noteText.trim() || !selectedSession} type="submit">
      Add Note (Ctrl+Enter)
    </button>
    {#if noteEntries.length > 0}
      <div class="list-stack">
        {#each noteEntries as note}
          <div class="entity-card entity-card--tight">
            <p class="font-medium">{note.text}</p>
            <p class="entity-card__meta">{note.timestamp}</p>
          </div>
        {/each}
      </div>
    {/if}
  </form>
</SurfaceCard>

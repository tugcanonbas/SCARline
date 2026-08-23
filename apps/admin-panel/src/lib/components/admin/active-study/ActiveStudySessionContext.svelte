<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatStatusLabel, shortId } from "$lib/format";

  let {
    formMessage = "",
    selectedSession = $bindable(""),
    sessions = [],
    socketState,
    layoutsLength,
    canOperate = false,
    validSessionActions = [],
    onLaunchBrowserWidgets,
    hasLayout = false,
    hasWindows = false,
  } = $props<{
    formMessage?: string;
    selectedSession?: string;
    sessions: Array<Record<string, unknown>>;
    socketState: string;
    layoutsLength: number;
    canOperate?: boolean;
    validSessionActions?: string[];
    onLaunchBrowserWidgets: () => void;
    hasLayout?: boolean;
    hasWindows?: boolean;
  }>();

  const ACTION_LABELS: Record<string, string> = {
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    complete: "Complete",
    cancel: "Cancel",
  };

  const launchDisabledReason = $derived(
    !selectedSession
      ? "Select a session first."
      : !hasLayout
        ? "This study has no participant layout to launch yet."
        : !hasWindows
          ? "The layout has no widget windows placed on it."
          : "",
  );
</script>

<SurfaceCard
  title="Session Context"
  subtitle="Select a session to manage its state, widgets, and lifecycle controls."
>
  {#if formMessage}
    <InlineNotice tone="danger" message={formMessage} />
  {/if}
  <label class="form-field mb-4">
    <span>Active Session</span>
    <select bind:value={selectedSession}>
      <option value="">Select session</option>
      {#each sessions as session}
        <option value={session.id}
          >{session.name ?? `Session ${shortId(session.id as string)}`} ({formatStatusLabel(session.status as string)})</option
        >
      {/each}
    </select>
  </label>
  <div class="detail-panel detail-panel--soft mb-4">
    <div class="toolbar">
      <span>Connection status</span>
      <StatusBadge status={socketState} />
    </div>
    <p>Layouts configured: <strong>{layoutsLength}</strong></p>
  </div>
  {#if canOperate}
    {#if validSessionActions.length > 0}
      <div class="control-rail">
        {#each validSessionActions as actionName}
          {#if actionName === "cancel"}
            <form method="POST" action="?/cancel">
              <input type="hidden" name="sessionId" value={selectedSession} />
              <input
                type="hidden"
                name="reason"
                value="Operator cancelled session"
              />
              <button class="button-danger button-block" type="submit"
                >{ACTION_LABELS[actionName]}</button
              >
            </form>
          {:else}
            <form method="POST" action={`?/${actionName}`}>
              <input type="hidden" name="sessionId" value={selectedSession} />
              <button class="button-secondary button-block" type="submit"
                >{ACTION_LABELS[actionName]}</button
              >
            </form>
          {/if}
        {/each}
      </div>
    {:else if selectedSession}
      <p class="entity-card__meta mb-4">
        No further actions — this session has reached its final state.
      </p>
    {/if}
    <button
      class="button-secondary mt-4"
      type="button"
      disabled={!!launchDisabledReason}
      onclick={onLaunchBrowserWidgets}
    >
      Open All Widgets as Browser Windows
    </button>
    {#if launchDisabledReason}
      <p class="entity-card__meta mt-2">{launchDisabledReason}</p>
    {/if}
  {/if}
</SurfaceCard>

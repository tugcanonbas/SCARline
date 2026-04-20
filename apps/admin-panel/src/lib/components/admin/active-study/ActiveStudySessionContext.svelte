<script lang="ts">
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let {
    formMessage = '',
    selectedSession = $bindable(''),
    sessions = [],
    socketState,
    layoutsLength,
    canOperate = false,
    canTransition,
    onLaunchBrowserWidgets,
    hasLayout = false,
    hasWindows = false
  } = $props<{
    formMessage?: string;
    selectedSession?: string;
    sessions: Array<Record<string, unknown>>;
    socketState: string;
    layoutsLength: number;
    canOperate?: boolean;
    canTransition: (actionName: string) => boolean;
    onLaunchBrowserWidgets: () => void;
    hasLayout?: boolean;
    hasWindows?: boolean;
  }>();
</script>

<SurfaceCard title="Session Context" subtitle="Operator control context without changing the session lifecycle actions.">
  {#if formMessage}
    <InlineNotice tone="danger" message={formMessage} />
  {/if}
  <label class="form-field">
    <span>Active Session</span>
    <select bind:value={selectedSession}>
      <option value="">Select session</option>
      {#each sessions as session}
        <option value={session.id}>{session.name ?? session.id} ({session.status})</option>
      {/each}
    </select>
  </label>
  <div class="detail-panel detail-panel--soft">
    <div class="toolbar">
      <span>Realtime socket state</span>
      <StatusBadge status={socketState} />
    </div>
    <p>Layouts configured: <strong>{layoutsLength}</strong></p>
  </div>
  {#if canOperate}
    <div class="control-rail">
      <form method="POST" action="?/start">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <button class="button-secondary button-block" disabled={!canTransition('start')} type="submit">Start</button>
      </form>
      <form method="POST" action="?/pause">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <button class="button-secondary button-block" disabled={!canTransition('pause')} type="submit">Pause</button>
      </form>
      <form method="POST" action="?/resume">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <button class="button-secondary button-block" disabled={!canTransition('resume')} type="submit">Resume</button>
      </form>
      <form method="POST" action="?/complete">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <button class="button-secondary button-block" disabled={!canTransition('complete')} type="submit">Complete</button>
      </form>
      <form method="POST" action="?/cancel">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <input type="hidden" name="reason" value="Operator cancelled session" />
        <button class="button-danger button-block" disabled={!canTransition('cancel')} type="submit">Cancel</button>
      </form>
    </div>
    <button
      class="button-secondary"
      type="button"
      disabled={!selectedSession || !hasLayout || !hasWindows}
      onclick={onLaunchBrowserWidgets}
    >
      Launch Browser Popup Widgets
    </button>
  {/if}
  <p class="muted-copy">Session lifecycle controls are wired to CoreAPI command routes for operator execution.</p>
</SurfaceCard>

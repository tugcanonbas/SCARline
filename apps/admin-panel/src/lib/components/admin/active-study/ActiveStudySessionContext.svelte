<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatStatusLabel, shortId } from "$lib/format";
  import { SESSION_OPERATION_ACCESS_REQUIRED } from "$lib/permissions";

  let {
    formMessage = "", selectedSession = $bindable(""), sessions = [], socketState,
    layoutsLength, canOperate = false, validSessionActions = [], latestCommand = null,
    commandPending = false, desktopConnected = false, selectedHostId = "",
    overlayFailure = null, browserMessage = "", browserMessageIsError = false,
    onLaunchBrowserWidgets, hasLayout = false, hasWindows = false,
  } = $props<{
    formMessage?: string; selectedSession?: string; sessions: Array<Record<string, unknown>>;
    socketState: string; layoutsLength: number; canOperate?: boolean;
    validSessionActions?: string[]; latestCommand?: Record<string, unknown> | null;
    commandPending?: boolean; desktopConnected?: boolean; selectedHostId?: string;
    overlayFailure?: Record<string, unknown> | null; browserMessage?: string;
    browserMessageIsError?: boolean; onLaunchBrowserWidgets: () => void;
    hasLayout?: boolean; hasWindows?: boolean;
  }>();

  const ACTION_LABELS: Record<string, string> = {
    start: "Start", pause: "Pause", resume: "Resume", complete: "Complete", abort: "Abort",
  };
  const commandStatus = $derived(String(latestCommand?.status ?? ""));
  const commandAction = $derived(String(latestCommand?.action ?? ""));
  const overlayFailureMessage = $derived(
    String(overlayFailure?.message ?? overlayFailure?.errorMessage ?? ""),
  );
  const requiredComponents = $derived(
    Array.isArray(latestCommand?.requiredComponents)
      ? latestCommand.requiredComponents.map(String)
      : [],
  );
  const acknowledgedComponents = $derived(
    Array.isArray(latestCommand?.acknowledgedComponents)
      ? latestCommand.acknowledgedComponents.map(String)
      : [],
  );
  const launchDisabledReason = $derived(
    !selectedSession ? "Select a session first."
      : !hasLayout ? "This study has no participant layout to launch yet."
        : !hasWindows ? "The layout has no widget windows placed on it." : "",
  );
</script>

<SurfaceCard title="Session Context" subtitle="Select a session to manage its state, widgets, and lifecycle controls.">
  {#if formMessage}<InlineNotice tone="danger" message={formMessage} />{/if}
  {#if overlayFailureMessage}
    <InlineNotice tone="danger" message={`The session is running, but the participant layout could not open: ${overlayFailureMessage}`} />
  {/if}
  {#if browserMessage}
    <InlineNotice tone={browserMessageIsError ? "danger" : "success"} message={browserMessage} />
  {/if}
  <label class="form-field mb-4">
    <span>Active Session</span>
    <select bind:value={selectedSession}>
      <option value="">Select session</option>
      {#each sessions as session}
        <option value={session.id}>{session.name ?? `Session ${shortId(session.id as string)}`} ({formatStatusLabel(session.status as string)})</option>
      {/each}
    </select>
  </label>
  <div class="detail-panel detail-panel--soft mb-4">
    <div class="toolbar"><span>Connection status</span><StatusBadge status={socketState} /></div>
    <p>Layouts configured: <strong>{layoutsLength}</strong></p>
    {#if commandStatus}
      <p>{commandAction ? `${formatStatusLabel(commandAction)} command` : "Lifecycle command"}: <strong>{formatStatusLabel(commandStatus)}</strong></p>
      {#if requiredComponents.length > 0}
        <p>
          Runtime preparation:
          <strong>{acknowledgedComponents.length} of {requiredComponents.length} components ready</strong>
        </p>
      {/if}
      {#if latestCommand?.errorMessage}<p>{String(latestCommand.errorMessage)}</p>{/if}
    {/if}
  </div>
  {#if validSessionActions.length > 0}
      <div class="control-rail">
        {#each validSessionActions as actionName}
          {#if actionName === "start"}
            <form method="POST" action="?/start">
              <input type="hidden" name="sessionId" value={selectedSession} />
              <input type="hidden" name="hostId" value={selectedHostId} />
              <label class="form-field mb-3">
                <span>Participant display</span>
                <select name="rendererMode" disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>
                  {#if desktopConnected}
                    <option value="desktop">Desktop overlay</option><option value="browser">Browser windows</option>
                  {:else}
                    <option value="browser">Browser windows</option><option value="desktop">Desktop overlay</option>
                  {/if}
                </select>
              </label>
              {#if !desktopConnected}
                <p class="entity-card__meta mb-3">The desktop overlay is unavailable. Browser positioning is best-effort.</p>
              {/if}
              <button class="button-secondary button-block" type="submit" disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>{ACTION_LABELS[actionName]}</button>
            </form>
          {:else if actionName === "abort"}
            <form method="POST" action="?/abort">
              <input type="hidden" name="sessionId" value={selectedSession} />
              <label class="form-field mb-3">
                <span>Reason for aborting</span>
                <textarea name="reason" rows="3" required disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined} placeholder="Explain why this session ended abnormally"></textarea>
              </label>
              <p class="entity-card__meta mb-3">Aborting is an abnormal termination and the reason will be stored with the session.</p>
              <button class="button-danger button-block" type="submit" disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>{ACTION_LABELS[actionName]}</button>
            </form>
          {:else}
            <form method="POST" action={`?/${actionName}`}>
              <input type="hidden" name="sessionId" value={selectedSession} />
              <button class="button-secondary button-block" type="submit" disabled={!canOperate || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>{ACTION_LABELS[actionName]}</button>
            </form>
          {/if}
        {/each}
      </div>
  {:else if selectedSession && !commandPending}
      <p class="entity-card__meta mb-4">No further actions — this session has reached its final state.</p>
  {/if}
  {#if overlayFailureMessage}
      <form method="POST" action="?/retryDesktop" class="mt-4">
        <input type="hidden" name="sessionId" value={selectedSession} />
        <input type="hidden" name="hostId" value={selectedHostId} />
        <button class="button-secondary button-block" type="submit" disabled={!canOperate || commandPending || !desktopConnected} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined}>Retry Desktop</button>
      </form>
  {/if}
  <button class="button-secondary mt-4" type="button" disabled={!canOperate || !!launchDisabledReason || commandPending} title={!canOperate ? SESSION_OPERATION_ACCESS_REQUIRED : undefined} onclick={onLaunchBrowserWidgets}>Open Browser Fallback</button>
  {#if launchDisabledReason}<p class="entity-card__meta mt-2">{launchDisabledReason}</p>{/if}
</SurfaceCard>

<script lang="ts">
  import { appPath } from "$lib/paths";

  let {
    study,
    readiness,
    canManage = false,
  } = $props<{
    study: Record<string, unknown>;
    readiness: Record<string, unknown>;
    canManage?: boolean;
  }>();

  const permissionMessage = "Researcher or administrator access is required.";
  const checks = $derived(
    Array.isArray(readiness.checks)
      ? readiness.checks as Array<Record<string, unknown>>
      : [],
  );
  const firstBlocker = $derived(
    checks.find((entry) => entry.blocking === true && entry.status === "not_ready") ?? null,
  );
  const studyStatusCheck = $derived(
    checks.find((entry) => entry.key === "study_status") ?? null,
  );
  const nonterminalSessionCount = $derived(
    Number((studyStatusCheck?.details as Record<string, unknown> | undefined)?.nonterminalSessionCount ?? 0),
  );
  const status = $derived(String(study.status ?? "draft"));
  const transitions = $derived(
    status === "draft"
      ? [{ to: "configured", label: "Mark Configured", danger: false }]
      : status === "configured"
        ? [
            { to: "draft", label: "Return to Draft", danger: false },
            { to: "ready", label: "Mark Ready", danger: false },
          ]
        : status === "ready"
          ? [{ to: "configured", label: "Return to Configured", danger: false }]
          : status === "running" && nonterminalSessionCount === 0
            ? [{ to: "completed", label: "Complete Study", danger: false }]
            : status === "completed"
              ? [{ to: "archived", label: "Archive Study", danger: true }]
              : [],
  );
</script>

<div class="action-strip" id="study-controls">
  {#each transitions as transition}
    {#if transition.to === "ready" && readiness.ready !== true && canManage}
      <a
        class="button-secondary"
        href={appPath(String(firstBlocker?.correctionRoute ?? `/user-studies/${study.id}/overview#checklist`))}
        title={String(firstBlocker?.message ?? "Complete the Quick Start steps first.")}
      >
        {transition.label}
      </a>
    {:else}
      <form method="POST" action="?/studyTransition">
        <input type="hidden" name="to" value={transition.to} />
        <button
          class={transition.danger ? "button-danger" : "button-secondary"}
          type="submit"
          disabled={!canManage}
          title={!canManage ? permissionMessage : undefined}
        >
          {transition.label}
        </button>
      </form>
    {/if}
  {/each}
</div>

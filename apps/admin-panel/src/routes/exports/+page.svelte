<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import FilterBar from "$lib/components/FilterBar.svelte";
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import StudyFilterSelect from "$lib/components/StudyFilterSelect.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatDate, formatStatusLabel } from "$lib/format";
  import { Download, Filter, Trash2 } from "lucide-svelte";

  let { data, form } = $props();

  const completedCount = $derived(
    data.exports.filter(
      (job: Record<string, unknown>) => job.status === "completed",
    ).length,
  );
  const activeCount = $derived(
    data.exports.filter(
      (job: Record<string, unknown>) =>
        job.status === "queued" || job.status === "running",
    ).length,
  );

  let newScope = $state("session");
  let newStudyId = $state("");
  let newSessionId = $state("");

  // Arriving with ?prefillSessionId=... (e.g. from a session log's "Full
  // Export" link) pre-fills the create form so the handoff doesn't lose
  // context, without fighting the list filters above which use `sessionId`.
  $effect(() => {
    if (data.prefillSessionId) {
      newScope = "session";
      newSessionId = data.prefillSessionId;
    }
  });
  let newFormat = $state("json");

  const newScopeLabel = $derived(
    newScope === "session"
      ? "this session's"
      : newScope === "study"
        ? "this study's"
        : "all",
  );
  const newStudyName = $derived(
    data.studies.find((s: Record<string, any>) => s.id === newStudyId)?.name,
  );
  const exportPreview = $derived.by(() => {
    let scopeText = `${newScopeLabel} events`;
    if (newScope !== "all" && newStudyName) {
      scopeText += ` from "${newStudyName}"`;
    }
    if (newScope === "session" && newSessionId.trim()) {
      scopeText += ` (session ${newSessionId.trim()})`;
    }
    return `This will export ${scopeText} as a ${newFormat.toUpperCase()} file.`;
  });

  const getExportTitle = (job: Record<string, any>) => {
    const studyId = job.studyId || job.study_id;
    if (studyId) {
      const study = data.studies.find(
        (s: Record<string, any>) => s.id === studyId,
      );
      return study
        ? `${study.name} ${job.scope === "session" ? "(Session)" : "Export"}`
        : "Unknown Study Export";
    }
    return `${formatStatusLabel(job.scope)} Export`;
  };
</script>

<PageHeader
  eyebrow="Data"
  title="Exports"
  description="Prepare study and session artifacts for analysis."
/>

{#if form?.message}
  <InlineNotice tone="danger" message={form.message} />
{/if}

<div class="metric-grid">
  <MetricCard
    label="Active"
    value={activeCount}
    hint="Queued or running exports"
  />
  <MetricCard
    label="Completed"
    value={completedCount}
    hint="Ready to download"
  />
</div>

<div class="mt-4">
  <SurfaceCard
    title="Exported studies and sessions"
    subtitle="Download and find your exports."
  >
    <form class="flex flex-col gap-4" method="GET">
      <FilterBar fieldCount={3}>
        <StudyFilterSelect studies={data.studies} value={data.filters.studyId} />
        <input
          class="w-full"
          style="width: 100%;"
          name="sessionId"
          placeholder="Session ID"
          value={data.filters.sessionId}
        />
        <select class="w-full" style="width: 100%;" name="status">
          <option value="">Any status</option>
          {#each ["queued", "running", "completed", "failed", "cancelled"] as status}
            <option value={status} selected={data.filters.status === status}
              >{formatStatusLabel(status)}</option
            >
          {/each}
        </select>
        <button class="button-primary h-full w-full" type="submit"
          ><Filter size={24} strokeWidth={1.5} /> Filter</button
        >
      </FilterBar>
    </form>
    <div class="list-stack mt-4">
      {#each data.exports as job}
        <div class="entity-card">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">
                {getExportTitle(job)} · {job.format}
              </p>
              <p class="entity-card__meta">{job.id}</p>
              <p class="entity-card__meta">
                Created {formatDate(job.createdAt ?? job.created_at)}
              </p>
            </div>
            <div class="pill-row">
              <StatusBadge status={job.status} />
              <span class="status-badge status-badge--muted"
                >{job.progress ?? 0}%</span
              >
              {#if job.status === "completed"}
                <a
                  class="button-primary"
                  href={appPath(`/exports/${job.id}/download`)}
                  ><Download size={16} /> Download</a
                >
              {/if}
              {#if data.canManage}
                <form method="POST" action="?/delete">
                  <input type="hidden" name="exportId" value={job.id} />
                  <button class="button-danger" type="submit">
                    {#if job.status === "queued" || job.status === "running"}
                      Cancel
                    {:else}
                      <Trash2 size={16} /> Delete
                    {/if}
                  </button>
                </form>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <EmptyState message="No export jobs match the current filters." />
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4">
  {#if data.canManage}
    <SurfaceCard
      title="Create Export"
      subtitle="Queue a study, session, or full dataset export."
    >
      <form class="form-stack" method="POST" action="?/create">
        <label class="form-field">
          <span>Scope</span>
          <select name="scope" bind:value={newScope}>
            <option value="session">Session</option>
            <option value="study">Study</option>
            <option value="all">All Data</option>
          </select>
        </label>
        {#if newScope !== "all"}
          <label class="form-field">
            <span>Study</span>
            <select name="studyId" bind:value={newStudyId}>
              <option value="">No study</option>
              {#each data.studies as study}
                <option value={study.id}>{study.name}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if newScope === "session"}
          <label class="form-field">
            <span>Session ID</span>
            <input
              name="sessionId"
              placeholder="Paste the session's ID"
              bind:value={newSessionId}
              required
            />
          </label>
        {/if}
        <label class="form-field">
          <span>Format</span>
          <select name="format" bind:value={newFormat}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="zip">ZIP</option>
          </select>
        </label>
        <p class="form-field__hint">{exportPreview}</p>
        <div class="form-actions">
          <button class="button-primary" type="submit">Queue Export</button>
        </div>
      </form>
    </SurfaceCard>
  {/if}
</div>

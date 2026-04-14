<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data, form } = $props();

  const completedCount = $derived(data.exports.filter((job: Record<string, unknown>) => job.status === 'completed').length);
  const activeCount = $derived(data.exports.filter((job: Record<string, unknown>) => job.status === 'queued' || job.status === 'running').length);
</script>

<PageHeader eyebrow="Data" title="Exports" description="Prepare study and session artifacts for analysis." />

{#if form?.message}
  <p class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">{form.message}</p>
{/if}

<div class="metric-grid">
  <div class="metric-card">
    <p class="metric-card__label">Export Jobs</p>
    <p class="metric-card__value">{data.exports.length}</p>
    <p class="metric-card__hint">Current filtered result</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Active</p>
    <p class="metric-card__value">{activeCount}</p>
    <p class="metric-card__hint">Queued or running</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Completed</p>
    <p class="metric-card__value">{completedCount}</p>
    <p class="metric-card__hint">Ready to download</p>
  </div>
  <div class="metric-card">
    <p class="metric-card__label">Studies</p>
    <p class="metric-card__value">{data.studies.length}</p>
    <p class="metric-card__hint">Available scopes</p>
  </div>
</div>

<div class="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
  {#if data.canManage}
    <SurfaceCard title="Create Export" subtitle="Queue a study, session, or full dataset export.">
      <form class="grid gap-3" method="POST" action="?/create">
      <label class="grid gap-2 text-sm">
        <span>Scope</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="scope">
          <option value="session">Session</option>
          <option value="study">Study</option>
          <option value="all">All Data</option>
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Study</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="studyId">
          <option value="">No study</option>
          {#each data.studies as study}
            <option value={study.id}>{study.name}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-2 text-sm">
        <span>Session UUID</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="sessionId" placeholder="Required for session scope" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Format</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="zip">ZIP</option>
        </select>
      </label>
        <button class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" type="submit">Queue Export</button>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard title="Filters" subtitle="Filter queued and completed artifacts.">
    <form class="grid gap-3 md:grid-cols-2" method="GET">
      <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="studyId">
        <option value="">All studies</option>
        {#each data.studies as study}
          <option value={study.id} selected={data.filters.studyId === study.id}>{study.name}</option>
        {/each}
      </select>
      <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="sessionId" placeholder="Session UUID" value={data.filters.sessionId} />
      <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="status">
        <option value="">Any status</option>
        {#each ['queued', 'running', 'completed', 'failed', 'cancelled'] as status}
          <option value={status} selected={data.filters.status === status}>{status}</option>
        {/each}
      </select>
      <button class="rounded-2xl border border-[--color-line] px-4 py-3 text-sm" type="submit">Apply</button>
    </form>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Export Jobs">
    <div class="space-y-3">
      {#each data.exports as job}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{job.scope} export · {job.format}</p>
              <p class="text-sm text-slate-400">{job.id}</p>
              <p class="mt-1 text-xs text-slate-500">Created {job.createdAt ?? job.created_at ?? 'unknown'}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <StatusBadge status={job.status} />
              <span class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-300">{job.progress ?? 0}%</span>
              {#if job.status === 'completed'}
                <a class="rounded-xl border border-[--color-line] px-3 py-2 text-xs text-slate-100" href={appPath(`/exports/${job.id}/download`)}>Download</a>
              {/if}
              {#if data.canManage}
                <form method="POST" action="?/delete">
                  <input type="hidden" name="exportId" value={job.id} />
                  <button class="rounded-xl border border-[--color-line] px-3 py-2 text-xs text-slate-100" type="submit">
                    {job.status === 'queued' || job.status === 'running' ? 'Cancel' : 'Delete'}
                  </button>
                </form>
              {/if}
            </div>
          </div>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No export jobs match the current filters.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import MetricCard from '$lib/components/admin/MetricCard.svelte';
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
  <InlineNotice tone="danger" message={form.message} />
{/if}

<div class="metric-grid">
  <MetricCard label="Export Jobs" value={data.exports.length} hint="Current filtered result" accent />
  <MetricCard label="Active" value={activeCount} hint="Queued or running" />
  <MetricCard label="Completed" value={completedCount} hint="Ready to download" />
  <MetricCard label="Studies" value={data.studies.length} hint="Available scopes" />
</div>

<div class="mt-4 section-grid section-grid--sidebar">
  {#if data.canManage}
    <SurfaceCard title="Create Export" subtitle="Queue a study, session, or full dataset export.">
      <form class="form-stack" method="POST" action="?/create">
      <label class="form-field">
        <span>Scope</span>
        <select name="scope">
          <option value="session">Session</option>
          <option value="study">Study</option>
          <option value="all">All Data</option>
        </select>
      </label>
      <label class="form-field">
        <span>Study</span>
        <select name="studyId">
          <option value="">No study</option>
          {#each data.studies as study}
            <option value={study.id}>{study.name}</option>
          {/each}
        </select>
      </label>
      <label class="form-field">
        <span>Session UUID</span>
        <input name="sessionId" placeholder="Required for session scope" />
      </label>
      <label class="form-field">
        <span>Format</span>
        <select name="format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="zip">ZIP</option>
        </select>
      </label>
        <div class="form-actions">
          <button class="button-primary" type="submit">Queue Export</button>
        </div>
      </form>
    </SurfaceCard>
  {/if}

  <SurfaceCard title="Filters" subtitle="Filter queued and completed artifacts.">
    <form class="form-grid-2" method="GET">
      <select name="studyId">
        <option value="">All studies</option>
        {#each data.studies as study}
          <option value={study.id} selected={data.filters.studyId === study.id}>{study.name}</option>
        {/each}
      </select>
      <input name="sessionId" placeholder="Session UUID" value={data.filters.sessionId} />
      <select name="status">
        <option value="">Any status</option>
        {#each ['queued', 'running', 'completed', 'failed', 'cancelled'] as status}
          <option value={status} selected={data.filters.status === status}>{status}</option>
        {/each}
      </select>
      <button class="button-secondary" type="submit">Apply</button>
    </form>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Export Jobs">
    <div class="list-stack">
      {#each data.exports as job}
        <div class="entity-card">
          <div class="entity-card__header">
            <div>
              <p class="entity-card__title">{job.scope} export · {job.format}</p>
              <p class="entity-card__meta">{job.id}</p>
              <p class="entity-card__meta">Created {job.createdAt ?? job.created_at ?? 'unknown'}</p>
            </div>
            <div class="pill-row">
              <StatusBadge status={job.status} />
              <span class="status-badge status-badge--muted">{job.progress ?? 0}%</span>
              {#if job.status === 'completed'}
                <a class="button-secondary" href={appPath(`/exports/${job.id}/download`)}>Download</a>
              {/if}
              {#if data.canManage}
                <form method="POST" action="?/delete">
                  <input type="hidden" name="exportId" value={job.id} />
                  <button class="button-secondary" type="submit">
                    {job.status === 'queued' || job.status === 'running' ? 'Cancel' : 'Delete'}
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

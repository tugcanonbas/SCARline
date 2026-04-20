<script lang="ts">
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Team" title={data.researcher.name} description="Researcher profile, assignment overview, and editable contact metadata." />

<div class="section-grid section-grid--sidebar">
  <SurfaceCard title="Profile">
    <form class="form-stack" method="POST" action="?/update">
      <label class="form-field">
        <span>Name</span>
        <input name="name" value={data.researcher.name} required />
      </label>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Email</span>
          <input name="email" type="email" value={data.researcher.email ?? ''} />
        </label>
        <label class="form-field">
          <span>Phone</span>
          <input name="phone" value={data.researcher.phone ?? ''} />
        </label>
      </div>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Institution</span>
          <input name="institution" value={data.researcher.institution ?? ''} />
        </label>
        <label class="form-field">
          <span>Role</span>
          <input name="role" value={data.researcher.role ?? ''} />
        </label>
      </div>
      <label class="form-field">
        <span>Notes</span>
        <textarea class="min-h-32" name="notes">{data.researcher.notes ?? ''}</textarea>
      </label>
      <div class="form-actions">
        <button class="button-primary" type="submit">Save Profile</button>
      </div>
    </form>
  </SurfaceCard>

  <div class="content-stack">
    <SurfaceCard title="Assigned Studies">
      <div class="list-stack">
        {#each data.studies as study}
          <a class="entity-card entity-card--tight" href={appPath(`/user-studies/${study.id}/overview`)}>
            <p class="entity-card__title">{study.name}</p>
            <p class="entity-card__meta">{study.status} · {study.assignment_role ?? 'member'}</p>
          </a>
        {:else}
          <EmptyState message="No assigned studies yet." />
        {/each}
      </div>
    </SurfaceCard>

    <SurfaceCard title="Admin Action">
      <form method="POST" action="?/delete">
        <button class="button-danger" type="submit">Delete Researcher</button>
      </form>
    </SurfaceCard>
  </div>
</div>

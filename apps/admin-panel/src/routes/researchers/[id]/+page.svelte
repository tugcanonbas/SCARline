<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Team" title={data.researcher.name} description="Researcher profile, assignment overview, and editable contact metadata." />

<div class="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
  <SurfaceCard title="Profile">
    <form class="grid gap-4" method="POST" action="?/update">
      <label class="grid gap-2 text-sm">
        <span>Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" value={data.researcher.name} required />
      </label>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Email</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="email" type="email" value={data.researcher.email ?? ''} />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Phone</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="phone" value={data.researcher.phone ?? ''} />
        </label>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Institution</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="institution" value={data.researcher.institution ?? ''} />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Role</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="role" value={data.researcher.role ?? ''} />
        </label>
      </div>
      <label class="grid gap-2 text-sm">
        <span>Notes</span>
        <textarea class="min-h-32 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="notes">{data.researcher.notes ?? ''}</textarea>
      </label>
      <div class="flex flex-wrap gap-3">
        <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Save Profile</button>
      </div>
    </form>
  </SurfaceCard>

  <div class="space-y-4">
    <SurfaceCard title="Assigned Studies">
      <div class="space-y-3">
        {#each data.studies as study}
          <a class="block rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" href={appPath(`/user-studies/${study.id}/overview`)}>
            <p class="font-semibold text-white">{study.name}</p>
            <p class="text-slate-400">{study.status} · {study.assignment_role ?? 'member'}</p>
          </a>
        {:else}
          <p class="text-sm text-slate-400">No assigned studies yet.</p>
        {/each}
      </div>
    </SurfaceCard>

    <SurfaceCard title="Admin Action">
      <form method="POST" action="?/delete">
        <button class="rounded-2xl border border-[--color-danger] px-4 py-3 text-sm text-[--color-danger]" type="submit">Delete Researcher</button>
      </form>
    </SurfaceCard>
  </div>
</div>

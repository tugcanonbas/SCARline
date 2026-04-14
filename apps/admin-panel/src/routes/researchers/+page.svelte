<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Team" title="Researchers" description="Manage researcher profiles and their assigned studies.">
  {#snippet actions()}
    {#if data.canManage}
      <a class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" href={appPath('/researchers/new')}>New Researcher</a>
    {/if}
  {/snippet}
</PageHeader>

<SurfaceCard title="Directory">
  <form class="mb-4 flex gap-3" method="GET">
    <input class="min-w-0 flex-1 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" name="search" placeholder="Search name, email, institution" value={data.search ?? ''} />
    <button class="rounded-2xl border border-[--color-line] px-4 py-3 text-sm" type="submit">Filter</button>
  </form>

  <div class="space-y-3">
    {#each data.researchers as researcher}
      <a class="block rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-4 transition hover:border-[--color-accent]/40" href={appPath(`/researchers/${researcher.id}`)}>
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="font-semibold text-white">{researcher.name}</p>
            <p class="text-sm text-slate-400">{researcher.email ?? 'No email'} · {researcher.institution ?? 'No institution'}</p>
          </div>
          <div class="text-sm text-slate-300">
            <p>{researcher.role ?? 'Researcher'}</p>
            <p>{researcher.activeStudiesCount ?? 0} assigned studies</p>
          </div>
        </div>
      </a>
    {:else}
      <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No researchers match the current filter.</p>
    {/each}
  </div>
</SurfaceCard>

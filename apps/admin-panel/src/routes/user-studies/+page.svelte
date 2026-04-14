<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Research Design" title="User Studies" description="Milestone-1 study list with direct navigation into configuration and active controls.">
  {#snippet actions()}
    {#if data.canManage}
      <a class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" href={appPath('/user-studies/new')}>New Study</a>
    {/if}
  {/snippet}
</PageHeader>

<SurfaceCard title="Studies">
  <div class="space-y-3">
    {#each data.studies as study}
      <a class="block rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-4 transition hover:border-[--color-accent]/40" href={appPath(`/user-studies/${study.id}/overview`)}>
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="font-semibold text-white">{study.name}</p>
            <p class="text-sm text-slate-400">{study.description ?? 'No description'}</p>
          </div>
          <div class="text-right text-sm text-slate-300">
            <p>{study.status}</p>
            <p>{study.participantCount} participants</p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</SurfaceCard>

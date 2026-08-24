<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { Plus } from "lucide-svelte";

  let { data } = $props();
</script>

<PageHeader
  eyebrow="Manage and view your team"
  title="Researchers"
  description="Manage researcher profiles and their assigned studies."
>
  {#snippet actions()}
    {#if data.canManage}
      <a class="button-primary" href={appPath("/researchers/new")}>
        <Plus size={24} strokeWidth={1.5} />
        New Researcher</a
      >
    {/if}
  {/snippet}
</PageHeader>

<SurfaceCard title="All Researchers">
  <form class="toolbar" method="GET">
    <input
      class="toolbar__grow"
      name="search"
      placeholder="Search name, email, institution"
      value={data.search ?? ""}
    />
    <button class="button-secondary" type="submit">Search</button>
  </form>

  <div class="list-stack">
    {#each data.researchers as researcher}
      <a class="entity-card" href={appPath(`/researchers/${researcher.id}`)}>
        <div class="entity-card__header">
          <div>
            <p class="entity-card__title">{researcher.name}</p>
            <p class="entity-card__meta">
              {researcher.email ?? "No email"} · {researcher.institution ??
                "No institution"}
            </p>
          </div>
          <div class="entity-card__meta">
            <p>{researcher.role ?? "Researcher"}</p>
            <p>{researcher.activeStudiesCount ?? 0} assigned studies</p>
          </div>
        </div>
      </a>
    {:else}
      <EmptyState message="No researchers match the current filter." />
    {/each}
  </div>
</SurfaceCard>

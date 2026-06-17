<script lang="ts">
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { appPath } from "$lib/paths";

  let { data } = $props();
</script>

<PageHeader
  eyebrow="Let's test something new"
  title="Create a new User Study"
  description="Enter a name and description to identify your user study. This information can be edited at any time."
/>

<div class="page-shell--wide">
  <SurfaceCard title="User Study Details">
    <form class="form-stack" method="POST">
      <label class="form-field required">
        <span>Study Name</span>
        <input name="name" required />
      </label>
      <label class="form-field">
        <span>Description</span>
        <textarea class="min-h-36" name="description"></textarea>
      </label>

      <div class="form-field">
        <span>Assign Researcher(s)</span>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {#each data.researchers as researcher}
            <label class="form-choice-card cursor-pointer">
              <input
                type="checkbox"
                name="researcherIds"
                value={researcher.id}
              />
              <div class="min-w-0">
                <p class="font-bold truncate">{researcher.name}</p>
                {#if researcher.institution}
                  <p class="text-xs text-slate-500 truncate">
                    {researcher.institution}
                  </p>
                {/if}
              </div>
            </label>
          {:else}
            <p class="text-sm text-slate-500 italic">
              No researchers found in the system.
            </p>
          {/each}
        </div>
      </div>
      <div class="form-actions">
        <button class="button-primary" type="submit">Create Study</button>
        <button
          class="button-secondary"
          type="button"
          onclick={() => history.back()}>Cancel</button
        >
      </div>
    </form>
  </SurfaceCard>
</div>

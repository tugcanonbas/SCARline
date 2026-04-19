<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader
  eyebrow="Docs"
  title="Documentation"
  description="Embedded PRD and implementation references served from the docs container without leaving the Admin shell."
/>

<div class="section-grid" style="grid-template-columns:minmax(0,1fr);">
  <SurfaceCard title="Reference Index">
    <div class="list-stack">
      {#each data.sections as section}
        <a
          class="entity-card entity-card--tight"
          href={section.href}
          target="docs-frame"
        >
          <span class="entity-card__title">{section.title}</span>
        </a>
      {/each}
    </div>
  </SurfaceCard>

  <SurfaceCard title="Docs Browser">
    <iframe
      class="h-[72vh] w-full rounded-2xl border border-[--color-line] bg-white"
      name="docs-frame"
      src={data.docsBase}
      title="SCARline Documentation"
    ></iframe>
  </SurfaceCard>
</div>

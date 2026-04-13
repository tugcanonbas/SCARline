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

<div class="grid gap-4 xl:grid-cols-[0.35fr_0.65fr]">
  <SurfaceCard title="Reference Index">
    <div class="space-y-3">
      {#each data.sections as section}
        <a
          class="block rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm text-slate-200 transition hover:border-[--color-accent]/40"
          href={section.href}
          target="docs-frame"
        >
          {section.title}
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

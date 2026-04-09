<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
</script>

<PageHeader eyebrow="Docs" title="Documentation" description="Requirement documents are served from the docs container and can be opened alongside this UI." />

<SurfaceCard title="Product Requirements">
  <p class="text-sm text-slate-300">
    Open the requirements bundle directly at <a class="text-[--color-accent]" href="/documentation/" target="_blank" rel="noreferrer">/documentation/</a>.
  </p>
</SurfaceCard>

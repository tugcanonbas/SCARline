<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Observability" title="Component Health" description="Current service state, used for lab bring-up and runtime monitoring." />

<SurfaceCard title="Component Status">
  <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.components, null, 2)}</pre>
</SurfaceCard>

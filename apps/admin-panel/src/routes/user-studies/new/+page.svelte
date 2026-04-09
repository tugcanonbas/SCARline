<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
</script>

<PageHeader eyebrow="Research Design" title="Create Study" description="Start with a study shell and fill the remaining milestone-1 configuration on the detail pages." />

<div class="max-w-3xl">
  <SurfaceCard title="Study Metadata">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Description</span>
        <textarea class="min-h-36 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="description"></textarea>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Create Study</button>
    </form>
  </SurfaceCard>
</div>

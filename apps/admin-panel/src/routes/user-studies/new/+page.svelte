<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
</script>

<PageHeader eyebrow="Research Design" title="Create Study" description="Start with a study shell and fill the remaining milestone-1 configuration on the detail pages." />

<div class="page-shell--wide">
  <SurfaceCard title="Study Metadata">
    <form class="form-stack" method="POST">
      <label class="form-field">
        <span>Name</span>
        <input name="name" required />
      </label>
      <label class="form-field">
        <span>Description</span>
        <textarea class="min-h-36" name="description"></textarea>
      </label>
      <div class="form-actions">
        <button class="button-primary" type="submit">Create Study</button>
      </div>
    </form>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
</script>

<PageHeader eyebrow="Team" title="Create Researcher" description="Add a researcher profile for study ownership and assignment." />

<div class="max-w-3xl">
  <SurfaceCard title="Profile">
    <form class="grid gap-4" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="name" required />
      </label>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Email</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="email" type="email" />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Phone</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="phone" />
        </label>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Institution</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="institution" />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Role</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="role" />
        </label>
      </div>
      <label class="grid gap-2 text-sm">
        <span>Notes</span>
        <textarea class="min-h-32 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="notes"></textarea>
      </label>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Create Researcher</button>
    </form>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { form } = $props();
</script>

<div class="mx-auto max-w-3xl py-10">
  <PageHeader
    eyebrow="Onboarding"
    title="Create the first researcher and admin"
    description="This account is used for the first sign-in and has full access to milestone-1 controls."
  />

  <SurfaceCard title="Admin Researcher">
    {#if form?.message}
      <p class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">
        {form.message}
      </p>
    {/if}

    <form class="grid gap-4 md:grid-cols-2" method="POST">
      <label class="grid gap-2 text-sm">
        <span>Full Name</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="fullName" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Email</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="email" type="email" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Institution</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="institution" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Research Role</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="role" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Username</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="username" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Password</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="password" type="password" minlength="8" required />
      </label>
      <div class="md:col-span-2">
        <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">
          Finish Setup
        </button>
      </div>
    </form>
  </SurfaceCard>
</div>

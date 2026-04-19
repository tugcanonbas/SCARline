<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data, form } = $props();
</script>

<div class="mx-auto max-w-xl py-16">
  <PageHeader
    eyebrow="Authentication"
    title="Sign into SCARline"
    description="Use the first admin account created during onboarding."
  />

  <SurfaceCard title="Operator Access" subtitle="JWT-backed session for Admin Panel and Overlay WebSocket connections.">
    <form class="grid gap-4" method="POST">
      <input name="redirectTo" type="hidden" value={data.redirectTo ?? ''} />

      <label class="grid gap-2 text-sm">
        <span class="text-slate-300">Username</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="username" required />
      </label>

      <label class="grid gap-2 text-sm">
        <span class="text-slate-300">Password</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="password" type="password" required />
      </label>

      {#if form?.message}
        <p class="rounded-2xl border border-[--color-danger]/30 bg-[--color-danger]/10 px-4 py-3 text-sm text-red-200">{form.message}</p>
      {/if}

      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">
        Sign In
      </button>
    </form>
  </SurfaceCard>
</div>

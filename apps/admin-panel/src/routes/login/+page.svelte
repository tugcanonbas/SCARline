<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";

  let { data, form } = $props();
</script>

<div class="page-shell--centered py-16">
  <PageHeader
    eyebrow="Authentication"
    title="Login to SCARline"
    description="Use the first admin account created during onboarding."
  />

  <SurfaceCard
    title="Login"
    subtitle="Enter your username and password to sign in."
  >
    <form class="form-stack" method="POST">
      <input name="redirectTo" type="hidden" value={data.redirectTo ?? ""} />

      <label class="form-field">
        <span>Username</span>
        <input name="username" required />
      </label>

      <label class="form-field">
        <span>Password</span>
        <input name="password" type="password" required />
      </label>

      {#if form?.message}
        <InlineNotice tone="danger" message={form.message} />
      {/if}

      <button class="button-primary" type="submit">Login</button>
    </form>
  </SurfaceCard>
</div>

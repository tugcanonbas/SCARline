<script lang="ts">
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { form } = $props();
</script>

<div class="page-shell--wide py-10">
  <PageHeader
    eyebrow="Onboarding"
    title="Create the first researcher and admin"
    description="This account is used for the first sign-in and has full administrative access to SCARline."
  />

  <SurfaceCard title="Admin Researcher">
    {#if form?.message}
      <InlineNotice tone="danger" message={form.message} />
    {/if}

    <form class="form-grid-2" method="POST">
      <label class="form-field">
        <span>Full Name</span>
        <input name="fullName" required />
      </label>
      <label class="form-field">
        <span>Email</span>
        <input name="email" type="email" />
      </label>
      <label class="form-field">
        <span>Institution</span>
        <input name="institution" />
      </label>
      <label class="form-field">
        <span>Research Role</span>
        <input name="role" />
      </label>
      <label class="form-field">
        <span>Username</span>
        <input name="username" required />
      </label>
      <label class="form-field">
        <span>Password</span>
        <input name="password" type="password" minlength="8" required />
      </label>
      <div class="form-actions md:col-span-2">
        <button class="button-primary" type="submit">Finish Setup</button>
      </div>
    </form>
  </SurfaceCard>
</div>

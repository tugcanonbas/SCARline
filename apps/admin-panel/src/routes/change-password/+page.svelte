<script lang="ts">
  import InlineNotice from "$lib/components/admin/InlineNotice.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";

  let { form } = $props();
</script>

<div class="page-shell--centered py-16">
  <PageHeader
    eyebrow="Authentication"
    title="Change your password"
    description="Replace the temporary password before continuing to SCARline."
  />

  <SurfaceCard title="" subtitle="">
    <form class="form-stack" method="POST">
      <label class="form-field">
        <span>Current Password</span>
        <input name="currentPassword" type="password" required />
      </label>

      <label class="form-field">
        <span>New Password</span>
        <input name="newPassword" type="password" minlength="12" required />
        <span class="form-field__hint">Use at least 12 characters.</span>
      </label>

      <label class="form-field">
        <span>Confirm New Password</span>
        <input name="confirmation" type="password" minlength="12" required />
      </label>

      {#if form?.message}
        <InlineNotice tone="danger" message={form.message} />
      {/if}

      <button class="button-primary" type="submit">Change Password</button>
    </form>
  </SurfaceCard>
</div>

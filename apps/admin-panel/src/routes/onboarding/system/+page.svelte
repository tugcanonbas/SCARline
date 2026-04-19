<script lang="ts">
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { form } = $props();
</script>

<div class="page-shell--wide py-10">
  <PageHeader
    eyebrow="Onboarding"
    title="System configuration"
    description="Save the lab path, platform port, and overlay behavior before creating the first admin user."
  />

  <SurfaceCard title="Host Settings">
    {#if form?.message}
      <InlineNotice tone="danger" message={form.message} />
    {/if}

    <form class="form-grid-2" method="POST">
      <label class="form-field md:col-span-2">
        <span>CARLA Server Path</span>
        <input name="carlaServerPath" placeholder="/opt/carla/CarlaUE4.sh" />
      </label>
      <label class="form-field">
        <span>Data Directory</span>
        <input name="dataDirectory" value=".scarline-runtime" required />
      </label>
      <label class="form-field">
        <span>Platform Port</span>
        <input name="platformPort" type="number" value="8088" required />
      </label>
      <label class="form-field">
        <span>CARLA RPC Port</span>
        <input name="carlaServerPort" type="number" value="2000" required />
      </label>
      <label class="form-choice-card">
        <input class="size-4" name="transparentOverlayEnabled" type="checkbox" checked />
        <span>Enable transparent overlay shell</span>
      </label>
      <div class="form-actions md:col-span-2">
        <button class="button-primary" type="submit">Continue</button>
      </div>
    </form>
  </SurfaceCard>
</div>

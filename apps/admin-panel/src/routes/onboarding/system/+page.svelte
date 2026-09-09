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

    <p class="form-field__hint mb-4">
      These settings point SCARline at the driving simulator it runs studies
      in. The default simulator is <strong>CARLA</strong>, a free,
      open-source driving simulator — if you installed SCARline with its
      standard setup, the defaults below already match it.
    </p>

    <form class="form-grid-2" method="POST">
      <label class="form-field md:col-span-2">
        <span>Simulator Path (Default: CARLA)</span>
        <input name="carlaServerPath" placeholder="/opt/carla/CarlaUE4.sh" />
        <span class="form-field__hint"
          >Path to the simulator executable on this machine, e.g. CarlaUE4.sh
          for a standard CARLA install.</span
        >
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
        <span>Simulator Port (Default: CARLA)</span>
        <input name="carlaServerPort" type="number" value="2000" required />
        <span class="form-field__hint"
          >Network port SCARline uses to control the simulator. Leave this as
          the default unless your simulator is set up differently.</span
        >
      </label>
      <label class="form-choice-card">
        <input class="size-4" name="transparentOverlayEnabled" type="checkbox" checked />
        <span>Enable transparent overlay shell</span>
      </label>
      <p class="form-field__hint md:col-span-2">
        Shows the participant-facing display with a see-through background,
        so it can sit on top of the simulator view during a study instead of
        covering it.
      </p>
      <div class="form-actions md:col-span-2">
        <button class="button-primary" type="submit">Continue</button>
      </div>
    </form>
  </SurfaceCard>
</div>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { form } = $props();
</script>

<div class="mx-auto max-w-3xl py-10">
  <PageHeader
    eyebrow="Onboarding"
    title="System configuration"
    description="Save the lab path, platform port, and overlay behavior before creating the first admin user."
  />

  <SurfaceCard title="Host Settings">
    {#if form?.message}
      <p class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100">
        {form.message}
      </p>
    {/if}

    <form class="grid gap-4 md:grid-cols-2" method="POST">
      <label class="grid gap-2 text-sm md:col-span-2">
        <span>CARLA Server Path</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="carlaServerPath" placeholder="/opt/carla/CarlaUE4.sh" />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Data Directory</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="dataDirectory" value=".scarline-runtime" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>Platform Port</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="platformPort" type="number" value="8088" required />
      </label>
      <label class="grid gap-2 text-sm">
        <span>CARLA RPC Port</span>
        <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="carlaServerPort" type="number" value="2000" required />
      </label>
      <label class="mt-7 flex items-center gap-3 text-sm">
        <input class="size-4" name="transparentOverlayEnabled" type="checkbox" checked />
        <span>Enable transparent overlay shell</span>
      </label>
      <div class="md:col-span-2">
        <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">
          Continue
        </button>
      </div>
    </form>
  </SurfaceCard>
</div>

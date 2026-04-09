<script lang="ts">
  let { eyebrow = '', title, description = '', actions } = $props<{
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: () => unknown;
  }>();
</script>

<header class="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
  <div class="space-y-2">
    {#if eyebrow}
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[--color-accent]">{eyebrow}</p>
    {/if}
    <h1 class="text-3xl font-semibold tracking-tight text-white md:text-4xl">{title}</h1>
    {#if description}
      <p class="max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
    {/if}
  </div>
  {@render actions?.()}
</header>

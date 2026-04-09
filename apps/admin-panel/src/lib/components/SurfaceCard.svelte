<script lang="ts">
  let { title = '', subtitle = '', children } = $props<{
    title?: string;
    subtitle?: string;
    children?: () => unknown;
  }>();
</script>

<section class="rounded-3xl border border-[--color-line] bg-[--color-panel]/85 p-5 shadow-[0_16px_44px_rgba(0,0,0,0.28)] backdrop-blur">
  {#if title}
    <header class="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold tracking-tight text-white">{title}</h2>
        {#if subtitle}
          <p class="mt-1 text-sm text-slate-400">{subtitle}</p>
        {/if}
      </div>
    </header>
  {/if}
  {@render children?.()}
</section>

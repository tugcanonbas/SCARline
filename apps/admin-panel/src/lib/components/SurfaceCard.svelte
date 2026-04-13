<script lang="ts">
  let { title = '', subtitle = '', children } = $props<{
    title?: string;
    subtitle?: string;
    children?: () => unknown;
  }>();
</script>

<section class="surface-card">
  {#if title}
    <header class="surface-card__header flex items-start justify-between gap-4">
      <div>
        <h2 class="surface-card__title">{title}</h2>
        {#if subtitle}
          <p class="surface-card__subtitle">{subtitle}</p>
        {/if}
      </div>
    </header>
  {/if}
  {@render children?.()}
</section>

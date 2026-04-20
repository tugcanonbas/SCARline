<script lang="ts">
  let {
    title = '',
    subtitle = '',
    children,
    actions,
    className = '',
    bodyClass = ''
  } = $props<{
    title?: string;
    subtitle?: string;
    children?: () => unknown;
    actions?: () => unknown;
    className?: string;
    bodyClass?: string;
  }>();
</script>

<section class={`surface-card ${className}`}>
  {#if title}
    <header class="surface-card__header">
      <div class="surface-card__header-copy">
        <h2 class="surface-card__title">{title}</h2>
        {#if subtitle}
          <p class="surface-card__subtitle">{subtitle}</p>
        {/if}
      </div>
      {#if actions}
        <div class="surface-card__actions">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}
  <div class={`surface-card__body ${bodyClass}`}>
    {@render children?.()}
  </div>
</section>

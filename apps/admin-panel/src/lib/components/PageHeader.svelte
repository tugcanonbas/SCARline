<script lang="ts">
  let {
    eyebrow = "",
    title,
    description = "",
    actions,
    className = "",
  } = $props<{
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: () => unknown;
    className?: string;
  }>();
</script>

<header class={`page-header ${className}`}>
  <div class="page-header__content">
    {#if eyebrow}
      <p class="page-header__kicker">{eyebrow}</p>
    {/if}
    <h1 class="page-header__title">{title}</h1>
    {#if description}
      <p class="page-header__description">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="page-header__actions">
      {@render actions()}
    </div>
  {/if}
</header>

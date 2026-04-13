<script lang="ts">
  let { eyebrow = '', title, description = '', actions } = $props<{
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: () => unknown;
  }>();
</script>

<header class="page-header flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
  <div class="space-y-2">
    {#if eyebrow}
      <p class="page-header__kicker">{eyebrow}</p>
    {/if}
    <h1 class="page-header__title">{title}</h1>
    {#if description}
      <p class="page-header__description">{description}</p>
    {/if}
  </div>
  {@render actions?.()}
</header>

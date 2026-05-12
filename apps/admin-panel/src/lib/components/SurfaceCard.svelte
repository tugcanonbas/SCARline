<script lang="ts">
  import type { Component } from 'svelte';
  import { Plus, List, TestTubeDiagonal, User } from 'lucide-svelte';

  let {
    title = '',
    subtitle = '',
    icon,
    children,
    actions,
    className = '',
    bodyClass = '',
    href = '',
    accent = false
  } = $props<{
    title?: string;
    subtitle?: string;
    icon?: Component<any> | 'plus' | 'list' | 'test-tube-diagonal' | 'user' | null;
    children?: () => unknown;
    actions?: () => unknown;
    className?: string;
    bodyClass?: string;
    href?: string;
    accent?: boolean;
  }>();

  const Icon = $derived(icon === 'plus' ? Plus : (icon === 'list' ? List : (icon === 'test-tube-diagonal' ? TestTubeDiagonal : (icon === 'user' ? User : (icon as Component<any>)))));
</script>

{#snippet Header()}
  {#if title || Icon}
    <header class="surface-card__header">
      <div class="surface-card__header-main">
        {#if Icon}
          <div class="surface-card__icon">
            <Icon size={24} strokeWidth={1.5} />
          </div>
        {/if}
        <div class="surface-card__header-copy">
          <h2 class="surface-card__title">{title}</h2>
          {#if subtitle}
            <p class="surface-card__subtitle">{subtitle}</p>
          {/if}
        </div>
      </div>
      {#if actions}
        <div class="surface-card__actions">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}
{/snippet}

{#if href}
  <a {href} class={`surface-card ${accent ? 'surface-card--accent' : ''} ${className}`}>
    {@render Header()}
    <div class={`surface-card__body ${bodyClass}`}>
      {@render children?.()}
    </div>
  </a>
{:else}
  <section class={`surface-card ${accent ? 'surface-card--accent' : ''} ${className}`}>
    {@render Header()}
    <div class={`surface-card__body ${bodyClass}`}>
      {@render children?.()}
    </div>
  </section>
{/if}

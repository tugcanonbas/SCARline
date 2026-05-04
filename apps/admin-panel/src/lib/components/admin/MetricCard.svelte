<script lang="ts">
  import type { Component } from "svelte";

  let {
    label,
    value,
    hint = "",
    accent = false,
    actions,
    valueContent,
    href,
    hrefText,
    icon,
  } = $props<{
    label: string;
    value?: string | number;
    hint?: string;
    accent?: boolean;
    actions?: () => unknown;
    valueContent?: () => unknown;
    href?: string;
    hrefText?: string;
    icon?: Component<any> | null;
  }>();
</script>

<div class={`metric-card ${accent ? "metric-card--accent" : ""}`}>
  <p class="metric-card__label">{label}</p>
  {#if valueContent}
    <div class="metric-card__content">
      {@render valueContent()}
    </div>
  {:else}
    <p class="metric-card__value">{value}</p>
  {/if}
  {#if hint}
    <p class="metric-card__hint">{hint}</p>
  {/if}
  {#if href}
    <a class="metric-card__link button-secondary" {href}>
      {#if icon}
        <svelte:component this={icon} size={16} />
      {/if}
      {hrefText}
    </a>
  {/if}
</div>

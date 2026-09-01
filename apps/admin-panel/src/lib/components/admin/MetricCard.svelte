<script lang="ts">
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
    // lucide-svelte currently exposes a legacy-compatible constructor type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: any;
  }>();
  const Icon = $derived(icon);
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
      {#if Icon}
        <Icon size={16} />
      {/if}
      {hrefText}
    </a>
  {/if}
</div>

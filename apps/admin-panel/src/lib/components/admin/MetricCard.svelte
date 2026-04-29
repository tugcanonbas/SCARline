<script lang="ts">
  let {
    label,
    value,
    hint = "",
    accent = false,
    actions,
    valueContent,
  } = $props<{
    label: string;
    value?: string | number;
    hint?: string;
    accent?: boolean;
    actions?: () => unknown;
    valueContent?: () => unknown;
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
</div>

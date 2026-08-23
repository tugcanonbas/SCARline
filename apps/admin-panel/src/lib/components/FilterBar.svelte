<script lang="ts">
  let { fieldCount, children } = $props<{
    fieldCount: number;
    children: () => unknown;
  }>();
</script>

<div
  class="filter-bar"
  style={`grid-template-columns: repeat(${fieldCount}, 1fr) auto;`}
>
  {@render children()}
</div>

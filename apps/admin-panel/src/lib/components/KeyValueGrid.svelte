<script lang="ts">
  type Item = {
    label: string;
    value: unknown;
  };

  let { items = [] } = $props<{
    items?: Item[];
  }>();

  function primitive(value: unknown): string {
    if (value === null || typeof value === 'undefined' || value === '') return 'None';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'string') return value;
    return String(value);
  }

  function format(value: unknown): string {
    if (Array.isArray(value)) {
      if (value.length === 0) return 'None';
      return value.map((entry) => format(entry)).join(', ');
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return 'None';
      return entries.map(([key, entry]) => `${key}: ${primitive(entry)}`).join(' | ');
    }

    return primitive(value);
  }
</script>

<div class="grid gap-3 md:grid-cols-2">
  {#each items as item}
    <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
      <p class="mt-2 break-words text-sm text-slate-100">{format(item.value)}</p>
    </div>
  {/each}
</div>

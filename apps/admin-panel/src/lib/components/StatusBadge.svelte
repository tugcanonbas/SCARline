<script lang="ts">
  let { status = 'unknown', label = status } = $props<{
    status?: string | null;
    label?: string | null;
  }>();

  function tone(value: string | null | undefined) {
    const normalized = String(value ?? 'unknown').toLowerCase();
    if (['running', 'ready', 'healthy', 'completed', 'active', 'open', 'true'].includes(normalized)) {
      return 'border-[--color-positive]/40 bg-[--color-positive]/15 text-emerald-100';
    }
    if (['paused', 'degraded', 'pending', 'created', 'draft', 'connecting'].includes(normalized)) {
      return 'border-[--color-warning]/40 bg-[--color-warning]/15 text-amber-100';
    }
    if (['failed', 'error', 'cancelled', 'disconnected', 'inactive', 'closed', 'false'].includes(normalized)) {
      return 'border-[--color-danger]/40 bg-[--color-danger]/15 text-red-100';
    }

    return 'border-[--color-line] bg-[--color-panel-soft] text-slate-200';
  }
</script>

<span class={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${tone(status)}`}>
  {label ?? status ?? 'unknown'}
</span>

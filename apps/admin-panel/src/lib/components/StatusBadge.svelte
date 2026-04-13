<script lang="ts">
  let { status = 'unknown', label = status } = $props<{
    status?: string | null;
    label?: string | null;
  }>();

  function tone(value: string | null | undefined) {
    const normalized = String(value ?? 'unknown').toLowerCase();
    if (['running', 'ready', 'healthy', 'completed', 'active', 'open', 'true'].includes(normalized)) {
      return '';
    }
    if (['paused', 'degraded', 'pending', 'created', 'draft', 'connecting'].includes(normalized)) {
      return 'status-badge--soft';
    }
    if (['failed', 'error', 'cancelled', 'disconnected', 'inactive', 'closed', 'false'].includes(normalized)) {
      return 'status-badge--soft';
    }

    return 'status-badge--soft';
  }
</script>

<span class={`status-badge ${tone(status)}`}>
  {label ?? status ?? 'unknown'}
</span>

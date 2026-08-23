<script lang="ts">
  import { formatStatusLabel } from '$lib/format';

  let { status = 'unknown', label = null } = $props<{
    status?: string | null;
    label?: string | null;
  }>();

  const displayLabel = $derived(label ?? formatStatusLabel(status));

  function tone(value: string | null | undefined) {
    const normalized = String(value ?? 'unknown').toLowerCase();
    if (
      ['running', 'ready', 'healthy', 'completed', 'active', 'open', 'true'].includes(
        normalized,
      )
    ) {
      return 'status-badge--success';
    }
    if (
      ['paused', 'degraded', 'pending', 'created', 'draft', 'connecting'].includes(
        normalized,
      )
    ) {
      return 'status-badge--warning';
    }
    if (
      ['failed', 'error', 'cancelled', 'disconnected', 'inactive', 'closed', 'false'].includes(
        normalized,
      )
    ) {
      return 'status-badge--danger';
    }

    if (['queued', 'scheduled', 'processing', 'manual-trigger'].includes(normalized)) {
      return 'status-badge--info';
    }

    return 'status-badge--muted';
  }
</script>

<span class={`status-badge ${tone(status)}`}>
  {displayLabel}
</span>

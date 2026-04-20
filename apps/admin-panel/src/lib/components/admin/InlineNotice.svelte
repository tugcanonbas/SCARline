<script lang="ts">
  let { tone = 'info', message } = $props<{
    tone?: 'info' | 'success' | 'warning' | 'danger';
    message: string;
  }>();
</script>

<p class={`inline-notice inline-notice--${tone}`}>{message}</p>

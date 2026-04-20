<script lang="ts">
  import AppShellNavItem from '$lib/components/admin/shell/AppShellNavItem.svelte';

  let { label, items, isActive, onSelect } = $props<{
    label: string;
    items: Array<{
      href: string;
      label: string;
      icon: unknown;
      external?: boolean;
    }>;
    isActive: (href: string) => boolean;
    onSelect?: () => void;
  }>();
</script>

<nav class="scarline-nav" aria-label={`${label} navigation`}>
  <p class="scarline-nav-label">{label}</p>
  {#each items as item}
    <AppShellNavItem item={item} active={isActive(item.href)} {onSelect} />
  {/each}
</nav>

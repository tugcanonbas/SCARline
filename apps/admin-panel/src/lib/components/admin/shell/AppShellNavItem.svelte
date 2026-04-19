<script lang="ts">
  import { appPath } from '$lib/paths';

  let { item, active = false, onSelect } = $props<{
    item: {
      href: string;
      label: string;
      icon: unknown;
    };
    active?: boolean;
    onSelect?: () => void;
  }>();
</script>

<a
  class={`scarline-nav-item ${active ? 'scarline-nav-item--active' : ''}`}
  aria-current={active ? 'page' : undefined}
  aria-label={item.label}
  href={appPath(item.href)}
  onclick={onSelect}
  title={item.label}
>
  <item.icon size={20} strokeWidth={1.7} />
  <span class="scarline-nav-item__label">{item.label}</span>
</a>

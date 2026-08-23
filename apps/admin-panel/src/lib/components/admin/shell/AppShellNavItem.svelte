<script lang="ts">
  import { appPath } from "$lib/paths";

  let {
    item,
    active = false,
    onSelect,
  } = $props<{
    item: {
      href: string;
      label: string;
      icon: unknown;
      external?: boolean;
    };
    active?: boolean;
    onSelect?: () => void;
  }>();

  const href = $derived(item.external ? item.href : appPath(item.href));
</script>

<a
  class={`scarline-nav-item ${active ? "scarline-nav-item--active" : ""}`}
  aria-current={active ? "page" : undefined}
  aria-label={item.label}
  {href}
  target={item.external ? "_blank" : undefined}
  rel={item.external ? "noopener noreferrer" : undefined}
  onclick={onSelect}
  title={item.label}
>
  <item.icon size={20} strokeWidth={1.7} />
  <span class="scarline-nav-item__label">{item.label}</span>
</a>

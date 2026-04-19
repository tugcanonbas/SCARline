<script lang="ts">
  import { LogOut } from 'lucide-svelte';
  import { appPath } from '$lib/paths';

  let { user, onSelect } = $props<{
    user?: {
      displayName?: string | null;
      username?: string | null;
      roles?: string[] | null;
    } | null;
    onSelect?: () => void;
  }>();
</script>

<div class="scarline-user-card">
  <p class="kv-label">Signed In</p>
  <p class="scarline-user-card__name">{user?.displayName ?? user?.username}</p>
  <p class="scarline-user-card__roles">{user?.roles?.join(', ')}</p>
  <a
    class="scarline-user-card__logout"
    href={appPath('/login?logout=1')}
    onclick={onSelect}
    title="Switch account"
  >
    <LogOut size={20} strokeWidth={1.7} />
    <span class="scarline-nav-item__label">Switch account</span>
  </a>
</div>

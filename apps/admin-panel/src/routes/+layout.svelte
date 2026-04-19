<script lang="ts">
  import '../app.css';
  import { BookOpenText, DatabaseBackup, Gauge, LayoutDashboard, LogOut, MonitorCog, Settings2, UserRoundCog, UsersRound } from 'lucide-svelte';
  import { appPath } from '$lib/paths';

  let { data, children } = $props();

  type Role = 'admin' | 'researcher' | 'operator' | 'viewer';
  type NavigationItem = {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    roles: Role[];
  };

  const allRoles: Role[] = ['admin', 'researcher', 'operator', 'viewer'];
  const designRoles: Role[] = ['admin', 'researcher'];
  const adminRoles: Role[] = ['admin'];
  const currentRoles = $derived((data.user?.roles ?? []) as Role[]);

  const primaryNavigation = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: allRoles },
    { href: '/user-studies', label: 'User Studies', icon: Gauge, roles: allRoles },
    { href: '/session-logs', label: 'Session Logs', icon: DatabaseBackup, roles: allRoles },
    { href: '/exports', label: 'Exports', icon: DatabaseBackup, roles: designRoles },
    { href: '/researchers', label: 'Researchers', icon: UsersRound, roles: designRoles }
  ] satisfies NavigationItem[];

  const utilityNavigation = [
    { href: '/settings/system', label: 'System', icon: Settings2, roles: adminRoles },
    { href: '/settings/users', label: 'Users', icon: UserRoundCog, roles: adminRoles },
    { href: '/settings/devices', label: 'Devices', icon: Settings2, roles: designRoles },
    { href: '/settings/components', label: 'Components', icon: MonitorCog, roles: designRoles },
    { href: '/documentation', label: 'Documentation', icon: BookOpenText, roles: allRoles }
  ] satisfies NavigationItem[];

  const visiblePrimaryNavigation = $derived(primaryNavigation.filter((item) => item.roles.some((role) => currentRoles.includes(role))));
  const visibleUtilityNavigation = $derived(utilityNavigation.filter((item) => item.roles.some((role) => currentRoles.includes(role))));
</script>

{#if data.isAuthenticated}
  <div class="scarline-shell">
    <aside class="scarline-sidebar">
      <div class="scarline-brand">
        <p class="scarline-brand-kicker">SCARline</p>
        <h1 class="scarline-brand-title">Research Ops</h1>
        <p class="scarline-brand-subtitle">Operational research console</p>
      </div>

      <nav class="scarline-nav" aria-label="Primary navigation">
        {#each visiblePrimaryNavigation as item}
          <a
            class="scarline-nav-item"
            href={appPath(item.href)}
          >
            <item.icon size={20} strokeWidth={1.7} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <nav class="scarline-nav scarline-nav-utility" aria-label="Utility navigation">
        {#each visibleUtilityNavigation as item}
          <a
            class="scarline-nav-item"
            href={appPath(item.href)}
          >
            <item.icon size={20} strokeWidth={1.7} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <div class="scarline-user-card">
        <p class="kv-label">Signed In</p>
        <p class="mt-2 text-base font-bold">{data.user?.displayName ?? data.user?.username}</p>
        <p class="text-sm text-slate-500">{data.user?.roles?.join(', ')}</p>
        <a
          class="mt-4 inline-flex items-center gap-2 text-sm underline"
          href={appPath('/login?logout=1')}
        >
          <LogOut size={20} strokeWidth={1.7} />
          <span>Switch account</span>
        </a>
      </div>
    </aside>

    <main class="scarline-main">
      <div class="scarline-content">
        {@render children()}
      </div>
    </main>
  </div>
{:else}
  <main class="scarline-main min-h-screen">
    <div class="scarline-content">
      {@render children()}
    </div>
  </main>
{/if}

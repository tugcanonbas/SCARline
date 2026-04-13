<script lang="ts">
  import { BookOpenText, DatabaseBackup, Gauge, LayoutDashboard, LogOut, MonitorCog, Settings2, UserRoundCog, UsersRound } from 'lucide-svelte';
  import { appPath } from '$lib/paths';

  let { data, children } = $props();

  const navigation = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/user-studies', label: 'User Studies', icon: Gauge },
    { href: '/session-logs', label: 'Session Logs', icon: DatabaseBackup },
    { href: '/exports', label: 'Exports', icon: DatabaseBackup },
    { href: '/researchers', label: 'Researchers', icon: UsersRound },
    { href: '/settings/system', label: 'System', icon: Settings2 },
    { href: '/settings/users', label: 'Users', icon: UserRoundCog },
    { href: '/settings/devices', label: 'Devices', icon: Settings2 },
    { href: '/settings/components', label: 'Components', icon: MonitorCog },
    { href: '/documentation', label: 'Documentation', icon: BookOpenText }
  ];
</script>

{#if data.isAuthenticated}
  <div class="min-h-screen md:grid md:grid-cols-[280px_1fr]">
    <aside class="border-b border-[--color-line] bg-[--color-panel]/80 p-6 md:border-b-0 md:border-r">
      <div class="mb-8 space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[--color-accent]">SCARline</p>
        <h1 class="text-2xl font-semibold">Research Ops</h1>
        <p class="text-sm text-slate-400">Milestone-1 operator console</p>
      </div>

      <nav class="space-y-2">
        {#each navigation as item}
          <a
            class="flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-sm text-slate-200 transition hover:border-[--color-line] hover:bg-[--color-panel-soft]"
            href={appPath(item.href)}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <div class="mt-10 rounded-3xl border border-[--color-line] bg-[--color-panel-soft] p-4">
        <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Signed In</p>
        <p class="mt-2 text-base font-semibold text-white">{data.user?.displayName ?? data.user?.username}</p>
        <p class="text-sm text-slate-400">{data.user?.roles?.join(', ')}</p>
        <a
          class="mt-4 inline-flex items-center gap-2 text-sm text-[--color-accent]"
          href={appPath('/login?logout=1')}
        >
          <LogOut size={14} />
          <span>Switch account</span>
        </a>
      </div>
    </aside>

    <main class="p-6 md:p-10">
      {@render children()}
    </main>
  </div>
{:else}
  <main class="min-h-screen p-6 md:p-10">
    {@render children()}
  </main>
{/if}

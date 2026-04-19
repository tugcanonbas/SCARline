<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import {
    BookOpenText,
    ChevronLeft,
    ChevronRight,
    DatabaseBackup,
    Gauge,
    LayoutDashboard,
    LogOut,
    Menu,
    MonitorCog,
    Settings2,
    UserRoundCog,
    UsersRound,
    X,
  } from "lucide-svelte";
  import { appPath } from "$lib/paths";

  let { data, children } = $props();

  type Role = "admin" | "researcher" | "operator" | "viewer";
  type NavigationItem = {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    roles: Role[];
  };

  const allRoles: Role[] = ["admin", "researcher", "operator", "viewer"];
  const designRoles: Role[] = ["admin", "researcher"];
  const adminRoles: Role[] = ["admin"];
  const currentRoles = $derived((data.user?.roles ?? []) as Role[]);

  const primaryNavigation = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      roles: allRoles,
    },
    {
      href: "/user-studies",
      label: "User Studies",
      icon: Gauge,
      roles: allRoles,
    },
    {
      href: "/session-logs",
      label: "Session Logs",
      icon: DatabaseBackup,
      roles: allRoles,
    },
    {
      href: "/exports",
      label: "Exports",
      icon: DatabaseBackup,
      roles: designRoles,
    },
    {
      href: "/researchers",
      label: "Researchers",
      icon: UsersRound,
      roles: designRoles,
    },
  ] satisfies NavigationItem[];

  const utilityNavigation = [
    {
      href: "/settings/system",
      label: "System",
      icon: Settings2,
      roles: adminRoles,
    },
    {
      href: "/settings/users",
      label: "Users",
      icon: UserRoundCog,
      roles: adminRoles,
    },
    {
      href: "/settings/devices",
      label: "Devices",
      icon: Settings2,
      roles: designRoles,
    },
    {
      href: "/settings/components",
      label: "Components",
      icon: MonitorCog,
      roles: designRoles,
    },
    {
      href: "/documentation",
      label: "Documentation",
      icon: BookOpenText,
      roles: allRoles,
    },
  ] satisfies NavigationItem[];

  const visiblePrimaryNavigation = $derived(
    primaryNavigation.filter((item) =>
      item.roles.some((role) => currentRoles.includes(role)),
    ),
  );
  const visibleUtilityNavigation = $derived(
    utilityNavigation.filter((item) =>
      item.roles.some((role) => currentRoles.includes(role)),
    ),
  );
  const currentPath = $derived(page.url.pathname);
  let mobileNavOpen = $state(false);
  let sidebarCollapsed = $state(false);

  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.scarlineSidebar = sidebarCollapsed
      ? "collapsed"
      : "expanded";
  });

  function isActive(href: string) {
    const target = appPath(href);
    return currentPath === target || currentPath.startsWith(`${target}/`);
  }

  function handleSidebarToggle() {
    sidebarCollapsed = !sidebarCollapsed;
  }
</script>

{#if data.isAuthenticated}
  <div class={`scarline-shell ${sidebarCollapsed ? "scarline-shell--collapsed" : ""}`}>
    <button
      class="scarline-mobile-toggle"
      aria-controls="scarline-sidebar"
      aria-expanded={mobileNavOpen}
      onclick={() => (mobileNavOpen = !mobileNavOpen)}
      type="button"
    >
      {#if mobileNavOpen}
        <X size={18} strokeWidth={1.9} />
        <span>Close navigation</span>
      {:else}
        <Menu size={18} strokeWidth={1.9} />
        <span>Open navigation</span>
      {/if}
    </button>

    <aside
      class={`scarline-sidebar ${mobileNavOpen ? "scarline-sidebar--open" : ""} ${sidebarCollapsed ? "scarline-sidebar--collapsed" : ""}`}
      id="scarline-sidebar"
      data-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <div class="scarline-brand">
        <p class="scarline-brand-kicker">SCARline</p>
        <h1 class="scarline-brand-title">Research Ops</h1>
        <p class="scarline-brand-subtitle">Operational research console</p>
      </div>

      <button
        class="scarline-sidebar-toggle"
        aria-controls="scarline-sidebar"
        aria-pressed={sidebarCollapsed}
        onclick={handleSidebarToggle}
        type="button"
      >
        {#if sidebarCollapsed}
          <ChevronRight size={18} strokeWidth={1.9} />
          <span class="scarline-sidebar-toggle__label">Expand sidebar</span>
        {:else}
          <ChevronLeft size={18} strokeWidth={1.9} />
          <span class="scarline-sidebar-toggle__label">Collapse sidebar</span>
        {/if}
      </button>

      <div class="scarline-sidebar-body">
        <nav
          class="scarline-nav scarline-nav-primary"
          aria-label="Primary navigation"
        >
          <p class="scarline-nav-label">Workspace</p>
          {#each visiblePrimaryNavigation as item}
            <a
              class={`scarline-nav-item ${isActive(item.href) ? "scarline-nav-item--active" : ""}`}
              aria-current={isActive(item.href) ? "page" : undefined}
              aria-label={item.label}
              href={appPath(item.href)}
              onclick={() => (mobileNavOpen = false)}
              title={item.label}
            >
              <item.icon size={20} strokeWidth={1.7} />
              <span class="scarline-nav-item__label">{item.label}</span>
            </a>
          {/each}
        </nav>

        <div class="scarline-sidebar-footer">
          <nav
            class="scarline-nav scarline-nav-utility"
            aria-label="Utility navigation"
          >
            <p class="scarline-nav-label">System</p>
            {#each visibleUtilityNavigation as item}
              <a
                class={`scarline-nav-item ${isActive(item.href) ? "scarline-nav-item--active" : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
                aria-label={item.label}
                href={appPath(item.href)}
                onclick={() => (mobileNavOpen = false)}
                title={item.label}
              >
                <item.icon size={20} strokeWidth={1.7} />
                <span class="scarline-nav-item__label">{item.label}</span>
              </a>
            {/each}
          </nav>

          <div class="scarline-user-card">
            <p class="kv-label">Signed In</p>
            <p class="mt-2 text-base font-bold">
              {data.user?.displayName ?? data.user?.username}
            </p>
            <p class="text-sm text-slate-500">{data.user?.roles?.join(", ")}</p>
            <a
              class="mt-4 inline-flex items-center gap-2 text-sm underline"
              href={appPath("/login?logout=1")}
              onclick={() => (mobileNavOpen = false)}
              title="Switch account"
            >
              <LogOut size={20} strokeWidth={1.7} />
              <span class="scarline-nav-item__label">Switch account</span>
            </a>
          </div>
        </div>
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

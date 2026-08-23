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
  import AppShellNavSection from "$lib/components/admin/shell/AppShellNavSection.svelte";
  import AppShellUserCard from "$lib/components/admin/shell/AppShellUserCard.svelte";
  import { appPath } from "$lib/paths";

  let { data, children } = $props();

  type Role = "admin" | "researcher" | "operator" | "viewer";
  type NavigationItem = {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
    roles: Role[];
    external?: boolean;
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

  const utilityNavigation = $derived([
    {
      href: "/settings",
      label: "Settings",
      icon: Settings2,
      roles: designRoles,
    },
    {
      href: data.docsUrl ?? "/docs/",
      label: "Documentation",
      icon: BookOpenText,
      roles: allRoles,
      external: true,
    },
  ] satisfies NavigationItem[]);

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

  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle(
      "scarline-no-scroll",
      mobileNavOpen,
    );
    return () => {
      document.documentElement.classList.remove("scarline-no-scroll");
    };
  });

  function isActive(href: string) {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return false;
    }
    const target = appPath(href);
    return currentPath === target || currentPath.startsWith(`${target}/`);
  }

  function handleSidebarToggle() {
    sidebarCollapsed = !sidebarCollapsed;
  }
</script>

{#if data.isAuthenticated}
  <div
    class={`scarline-shell ${sidebarCollapsed ? "scarline-shell--collapsed" : ""}`}
  >
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

    {#if mobileNavOpen}
      <button
        class="scarline-sidebar-backdrop"
        aria-label="Close navigation"
        onclick={() => (mobileNavOpen = false)}
        type="button"
      ></button>
    {/if}

    <aside
      class={`scarline-sidebar ${mobileNavOpen ? "scarline-sidebar--open" : ""} ${sidebarCollapsed ? "scarline-sidebar--collapsed" : ""}`}
      id="scarline-sidebar"
      data-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <div class="scarline-brand">
        <div class="branding">
          <p class="scarline-brand-kicker">SCARline Lab</p>
          <h1 class="scarline-brand-title">SCARline Hub</h1>
          <p class="scarline-brand-subtitle">Rapid-Prototyping platform</p>
        </div>
        <div class="toggle-button">
          <button
            class="scarline-sidebar-toggle"
            aria-controls="scarline-sidebar"
            aria-pressed={sidebarCollapsed}
            onclick={handleSidebarToggle}
            type="button"
          >
            {#if sidebarCollapsed}
              <ChevronRight size={30} strokeWidth={1.9} />
            {:else}
              <ChevronLeft size={30} strokeWidth={1.9} />
            {/if}
          </button>
        </div>
      </div>

      <div class="scarline-sidebar-body">
        <div class="scarline-nav-primary">
          <AppShellNavSection
            label="Workspace"
            items={visiblePrimaryNavigation}
            {isActive}
            onSelect={() => (mobileNavOpen = false)}
          />
        </div>

        <div class="scarline-sidebar-footer">
          <div class="scarline-nav-utility">
            <AppShellNavSection
              label="System"
              items={visibleUtilityNavigation}
              {isActive}
              onSelect={() => (mobileNavOpen = false)}
            />
          </div>

          <AppShellUserCard
            user={data.user}
            onSelect={() => (mobileNavOpen = false)}
          />
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

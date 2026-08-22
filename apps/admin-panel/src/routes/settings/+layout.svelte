<script lang="ts">
  import { page } from "$app/state";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { Settings2, UserRoundCog, MonitorCog, Server } from "lucide-svelte";

  let { data, children } = $props();

  const currentPath = $derived(page.url.pathname.replace(/\/$/, ""));

  function isCurrent(path: string) {
    const target = appPath(path).replace(/\/$/, "");
    return currentPath === target || currentPath.startsWith(target + "/");
  }
</script>

<PageHeader
  eyebrow="Configuration"
  title="SCARline Settings"
  description="Manage system variables, user accounts, and device configurations."
/>

<div class="study-tabs">
  {#if data.user?.roles?.includes("admin")}
    <a
      class={`study-tab ${page.url.pathname.includes("/settings/system") ? "study-tab--active" : ""}`}
      href={appPath("/settings/system")}
      aria-current={page.url.pathname.includes("/settings/system")
        ? "page"
        : undefined}
    >
      <Settings2 size={16} />
      System
    </a>
    <a
      class={`study-tab ${page.url.pathname.includes("/settings/users") ? "study-tab--active" : ""}`}
      href={appPath("/settings/users")}
      aria-current={page.url.pathname.includes("/settings/users")
        ? "page"
        : undefined}
    >
      <UserRoundCog size={16} />
      Accounts
    </a>
  {/if}
  {#if data.user?.roles?.includes("admin") || data.user?.roles?.includes("researcher")}
    <a
      class={`study-tab ${page.url.pathname.includes("/settings/devices") ? "study-tab--active" : ""}`}
      href={appPath("/settings/devices")}
      aria-current={page.url.pathname.includes("/settings/devices")
        ? "page"
        : undefined}
    >
      <MonitorCog size={16} />
      Device Setup
    </a>
    <a
      class={`study-tab ${page.url.pathname.includes("/settings/components") ? "study-tab--active" : ""}`}
      href={appPath("/settings/components")}
      aria-current={page.url.pathname.includes("/settings/components")
        ? "page"
        : undefined}
    >
      <Server size={16} />
      Component Status
    </a>
  {/if}
</div>

{@render children()}

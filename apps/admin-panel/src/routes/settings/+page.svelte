<script lang="ts">
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { Settings2, UserRoundCog, MonitorCog, Server } from "lucide-svelte";
  import { appPath } from "$lib/paths";

  let { data } = $props();
</script>

<div class="kv-grid">
  {#if data.roles.includes("admin")}
    <SurfaceCard
      title="System Settings"
      href={appPath("/settings/system")}
      icon={Settings2}
    >
      <p class="kv-value">
        Configure core platform variables and environment options.
      </p>
    </SurfaceCard>

    <SurfaceCard
      title="User Accounts"
      href={appPath("/settings/users")}
      icon={UserRoundCog}
    >
      <p class="kv-value">
        Manage researcher and operator accounts and permissions.
      </p>
    </SurfaceCard>
  {/if}

  {#if data.roles.includes("admin") || data.roles.includes("researcher")}
    <SurfaceCard
      title="Device Settings"
      href={appPath("/settings/devices")}
      icon={MonitorCog}
    >
      <p class="kv-value">Register and configure lab hardware components.</p>
    </SurfaceCard>

    <SurfaceCard
      title="System Status"
      href={appPath("/settings/components")}
      icon={Server}
    >
      <p class="kv-value">
        Monitor the health of connected SCARline services.
      </p>
    </SurfaceCard>
  {/if}
</div>

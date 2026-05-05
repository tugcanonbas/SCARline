<script lang="ts">
  import { appPath } from "$lib/paths";
  import {
    ArrowLeft,
    FileText,
    ScanEye,
    CarFront,
    GalleryThumbnails,
    TestTubeDiagonal,
  } from "lucide-svelte";

  let { studyId, current, icon } = $props<{
    studyId: string;
    current: string;
    icon?: string;
  }>();

  const tabs = $derived.by(() => {
    const basePath = `/user-studies/${studyId}`;

    return [
      { href: `${basePath}/overview`, label: "Overview", icon: FileText },
      {
        href: `${basePath}/conditions`,
        label: "Conditions",
        icon: TestTubeDiagonal,
      },
      {
        href: `${basePath}/carla-config`,
        label: "CARLA Config",
        icon: CarFront,
      },
      { href: `${basePath}/sensors`, label: "Sensors", icon: ScanEye },
      {
        href: `${basePath}/participant-view`,
        label: "Participant View",
        icon: GalleryThumbnails,
      },
      { href: `${basePath}/active-study`, label: "Active Study" },
    ];
  });
</script>

<nav class="study-tabs">
  <a
    class="study-tab"
    href={appPath("/user-studies")}
    aria-label="Back to all user studies"
  >
    <ArrowLeft size={16} />
    Back to all
  </a>
  {#each tabs as tab}
    <a
      class={`study-tab ${current === tab.href ? "study-tab--active" : ""}`}
      aria-current={current === tab.href ? "page" : undefined}
      href={appPath(tab.href)}
    >
      {#if tab.icon}
        <svelte:component this={tab.icon} size={16} />
      {/if}

      {tab.label}
    </a>
  {/each}
</nav>

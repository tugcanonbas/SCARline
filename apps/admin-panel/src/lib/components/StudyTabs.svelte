<script lang="ts">
  import { appPath } from "$lib/paths";
  import { ArrowLeft } from "lucide-svelte";
  import {
    STUDY_SECTIONS,
    STUDY_SECTION_ORDER,
    studySectionHref,
  } from "$lib/studySections";

  let { studyId, current } = $props<{
    studyId: string;
    current: string;
  }>();

  const tabs = $derived(
    STUDY_SECTION_ORDER.map((key) => ({
      href: studySectionHref(studyId, key),
      label: STUDY_SECTIONS[key].label,
      icon: STUDY_SECTIONS[key].icon,
    })),
  );
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
        <tab.icon size={16} />
      {/if}

      {tab.label}
    </a>
  {/each}
</nav>

<script lang="ts">
  import { appPath } from '$lib/paths';

  let { studyId, current } = $props<{
    studyId: string;
    current: string;
  }>();

  const tabs = $derived.by(() => {
    const basePath = `/user-studies/${studyId}`;

    return [
      { href: `${basePath}/overview`, label: 'Overview' },
      { href: `${basePath}/participants`, label: 'Participants' },
      { href: `${basePath}/conditions`, label: 'Conditions' },
      { href: `${basePath}/sessions`, label: 'Sessions' },
      { href: `${basePath}/carla-config`, label: 'CARLA Config' },
      { href: `${basePath}/sensors`, label: 'Sensors' },
      { href: `${basePath}/participant-view`, label: 'Participant View' },
      { href: `${basePath}/active-study`, label: 'Active Study' }
    ];
  });
</script>

<nav class="study-tabs">
  {#each tabs as tab}
    <a
      class={`study-tab ${current === tab.href ? 'study-tab--active' : ''}`}
      aria-current={current === tab.href ? 'page' : undefined}
      href={appPath(tab.href)}
    >
      {tab.label}
    </a>
  {/each}
</nav>

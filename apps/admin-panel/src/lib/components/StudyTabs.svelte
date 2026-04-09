<script lang="ts">
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

<nav class="mb-6 flex flex-wrap gap-2">
  {#each tabs as tab}
    <a
      class={[
        'rounded-full border px-4 py-2 text-sm transition',
        current === tab.href
          ? 'border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]'
          : 'border-[--color-line] bg-[--color-panel-soft] text-slate-300 hover:border-[--color-accent]/40'
      ].join(' ')}
      href={tab.href}
    >
      {tab.label}
    </a>
  {/each}
</nav>

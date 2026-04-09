<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
</script>

<PageHeader eyebrow="Study" title={data.study.name} description={data.study.description ?? 'No description yet.'} />
<StudyTabs studyId={data.study.id} current={`/user-studies/${data.study.id}/overview`} />

<SurfaceCard title="Study Snapshot">
  <pre class="overflow-auto rounded-2xl bg-black/30 p-4 text-sm text-slate-300">{JSON.stringify(data.study, null, 2)}</pre>
</SurfaceCard>

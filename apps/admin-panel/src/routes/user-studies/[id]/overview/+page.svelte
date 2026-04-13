<script lang="ts">
  import KeyValueGrid from '$lib/components/KeyValueGrid.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import StudyTabs from '$lib/components/StudyTabs.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const studyItems = $derived([
    { label: 'Status', value: data.study.status },
    { label: 'Version', value: data.study.version ?? '1' },
    { label: 'Participants', value: data.study.participantCount ?? data.study.participant_count ?? 0 },
    { label: 'Created', value: data.study.createdAt ?? data.study.created_at ?? 'Unknown' },
    { label: 'Updated', value: data.study.updatedAt ?? data.study.updated_at ?? 'Unknown' },
    { label: 'Owner', value: data.study.createdBy ?? data.study.created_by ?? 'Not assigned' }
  ]);
</script>

<PageHeader eyebrow="Study" title={data.study.name} description={data.study.description ?? 'No description yet.'} />
<StudyTabs studyId={data.study.id} current={`/user-studies/${data.study.id}/overview`} />

<SurfaceCard title="Study Snapshot">
  <div class="mb-4">
    <StatusBadge status={data.study.status} />
  </div>
  <KeyValueGrid items={studyItems} />
</SurfaceCard>

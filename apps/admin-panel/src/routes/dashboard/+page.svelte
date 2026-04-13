<script lang="ts">
  import { appPath } from '$lib/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { createRealtimeStore } from '$lib/stores/realtime';

  type RecentSession = {
    id: string;
    studyId: string;
    participantId: string | null;
    conditionId: string | null;
    name: string | null;
    status: string;
    startedAt: string | null;
    pausedAt: string | null;
    completedAt: string | null;
    durationSeconds: number | null;
    runtimeMetadata: Record<string, unknown>;
    notes: string | null;
  };

  type ComponentHealth = {
    componentId: string;
    componentName?: string;
    status: string;
    checkedAt: string;
    message?: string;
  };

  let { data }: {
    data: {
      dashboard: {
        activeStudies: number;
        totalSessions: number;
        totalParticipants: number;
        totalEvents: number;
        recentSessions: RecentSession[];
        componentHealth: ComponentHealth[];
      };
      token: string | null;
    };
  } = $props();

  const live = createRealtimeStore();
  const { events: sessionEvents, systemHealth, connect, disconnect } = live;

  let recentSessions = $state<RecentSession[]>([]);
  let componentHealth = $state<ComponentHealth[]>([]);

  $effect(() => {
    recentSessions = data.dashboard.recentSessions;
    componentHealth = data.dashboard.componentHealth;
  });

  $effect(() => {
    connect(data.token, ['session.events', 'system.health']);
    return () => disconnect();
  });

  $effect(() => {
    const latest = $sessionEvents[0];
    if (!latest?.sessionId) {
      return;
    }

    const sessionId = String(latest.sessionId);
    const timestamp = typeof latest.timestamp === 'string'
      ? latest.timestamp
      : typeof latest.startedAt === 'string'
        ? latest.startedAt
        : new Date().toISOString();
    const normalized: RecentSession = {
      id: sessionId,
      studyId: String(latest.studyId ?? ''),
      participantId: typeof latest.participantId === 'string' ? latest.participantId : null,
      conditionId: typeof latest.conditionId === 'string' ? latest.conditionId : null,
      name: typeof latest.name === 'string' ? latest.name : null,
      status: String(latest.status ?? 'running'),
      startedAt: typeof latest.startedAt === 'string' ? latest.startedAt : (latest.status === 'running' ? timestamp : null),
      pausedAt: latest.status === 'paused' ? timestamp : null,
      completedAt: ['completed', 'cancelled'].includes(String(latest.status ?? '')) ? timestamp : null,
      durationSeconds: typeof latest.durationSeconds === 'number' ? latest.durationSeconds : null,
      runtimeMetadata: typeof latest.runtimeMetadata === 'object' && latest.runtimeMetadata !== null
        ? latest.runtimeMetadata as Record<string, unknown>
        : {},
      notes: null
    };

    recentSessions = [
      normalized,
      ...recentSessions.filter((session: RecentSession) => session.id !== sessionId)
    ].slice(0, 5);
  });

  $effect(() => {
    const latest = $systemHealth[0];
    if (!latest?.componentId) {
      return;
    }

    const normalized: ComponentHealth = {
      componentId: String(latest.componentId),
      componentName: typeof latest.componentName === 'string' ? latest.componentName : undefined,
      status: String(latest.status ?? 'unknown'),
      checkedAt: typeof latest.checkedAt === 'string' ? latest.checkedAt : new Date().toISOString(),
      message: typeof latest.message === 'string' ? latest.message : undefined
    };

    componentHealth = [
      normalized,
      ...componentHealth.filter((component: ComponentHealth) => component.componentId !== normalized.componentId)
    ];
  });

  function formatDate(value: string | null) {
    if (!value) return 'Not recorded';
    return new Date(value).toLocaleString();
  }

  function sessionTimestamp(session: RecentSession) {
    return session.completedAt ?? session.pausedAt ?? session.startedAt;
  }
</script>

<PageHeader
  eyebrow="Mission Control"
  title="Dashboard"
  description="Health, study state, and recent session activity for the current lab runtime."
>
  {#snippet actions()}
    <div class="flex gap-3">
      <a class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm" href={appPath('/user-studies/new')}>New Study</a>
      <a class="rounded-2xl bg-[--color-accent-strong] px-4 py-3 text-sm font-semibold text-white" href={appPath('/startup')}>Startup View</a>
    </div>
  {/snippet}
</PageHeader>

<div class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
  <div class="grid gap-4 md:grid-cols-2">
    <SurfaceCard title="Active Studies"><p class="text-3xl font-semibold">{data.dashboard.activeStudies}</p></SurfaceCard>
    <SurfaceCard title="Total Sessions"><p class="text-3xl font-semibold">{data.dashboard.totalSessions}</p></SurfaceCard>
    <SurfaceCard title="Participants"><p class="text-3xl font-semibold">{data.dashboard.totalParticipants}</p></SurfaceCard>
    <SurfaceCard title="Captured Events"><p class="text-3xl font-semibold">{data.dashboard.totalEvents}</p></SurfaceCard>
  </div>

  <SurfaceCard title="Component Health">
    <div class="space-y-3">
      {#each componentHealth as component}
        <div class="flex items-center justify-between rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3 text-sm">
          <div>
            <p class="font-semibold text-white">{component.componentName ?? component.componentId}</p>
            <p class="text-xs text-slate-500">{formatDate(component.checkedAt)}</p>
          </div>
          <StatusBadge status={component.status} />
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No component health events have been received yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4">
  <SurfaceCard title="Recent Sessions">
    <div class="space-y-3">
      {#each recentSessions as session}
        <a class="block rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4 transition hover:border-[--color-accent]/40" href={appPath(`/user-studies/${session.studyId}/sessions`)}>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="font-semibold text-white">{session.name ?? session.id}</p>
              <p class="mt-1 text-sm text-slate-400">
                Participant {session.participantId ?? 'unassigned'} · Condition {session.conditionId ?? 'none'}
              </p>
            </div>
            <div class="text-left md:text-right">
              <StatusBadge status={session.status} />
              <p class="mt-2 text-xs text-slate-500">{formatDate(sessionTimestamp(session))}</p>
            </div>
          </div>
        </a>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No sessions have been created yet.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>

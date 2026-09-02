<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import MetricCard from "$lib/components/admin/MetricCard.svelte";
  import { appPath } from "$lib/paths";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { createRealtimeStore } from "$lib/stores/realtime";
  import { formatDate } from "$lib/format";
  import { untrack } from "svelte";

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

  type ActiveStudy = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    participantCount: number;
    sessionCount: number;
    createdAt: string;
    updatedAt: string;
  };

  let {
    data,
  }: {
    data: {
      dashboard: {
        activeStudies: number;
        totalSessions: number;
        totalParticipants: number;
        totalEvents: number;
        recentSessions: RecentSession[];
        activeStudyItems: ActiveStudy[];
        componentHealth: ComponentHealth[];
      };
      webSocketOrigin: string;
    };
  } = $props();

  const live = createRealtimeStore();
  const { events: sessionEvents, systemHealth, connect, disconnect } = live;

  let recentSessions = $state<RecentSession[]>([]);
  let componentHealth = $state<ComponentHealth[]>([]);

  function mergeRecentSession(session: RecentSession) {
    const current = untrack(() => recentSessions);
    recentSessions = [
      session,
      ...current.filter((entry) => entry.id !== session.id),
    ].slice(0, 5);
  }

  function mergeComponentHealthEntry(component: ComponentHealth) {
    const current = untrack(() => componentHealth);
    componentHealth = [
      component,
      ...current.filter((entry) => entry.componentId !== component.componentId),
    ];
  }

  $effect(() => {
    recentSessions = data.dashboard.recentSessions;
    componentHealth = data.dashboard.componentHealth;
  });

  $effect(() => {
    connect(["system.health"], {}, data.webSocketOrigin);
    return () => disconnect();
  });

  $effect(() => {
    const latest = $sessionEvents[0];
    if (!latest?.sessionId) {
      return;
    }

    const sessionId = String(latest.sessionId);
    const timestamp =
      typeof latest.timestamp === "string"
        ? latest.timestamp
        : typeof latest.startedAt === "string"
          ? latest.startedAt
          : new Date().toISOString();
    const normalized: RecentSession = {
      id: sessionId,
      studyId: String(latest.studyId ?? ""),
      participantId:
        typeof latest.participantId === "string" ? latest.participantId : null,
      conditionId:
        typeof latest.conditionId === "string" ? latest.conditionId : null,
      name: typeof latest.name === "string" ? latest.name : null,
      status: String(latest.status ?? "running"),
      startedAt:
        typeof latest.startedAt === "string"
          ? latest.startedAt
          : latest.status === "running"
            ? timestamp
            : null,
      pausedAt: latest.status === "paused" ? timestamp : null,
      completedAt: ["completed", "cancelled"].includes(
        String(latest.status ?? ""),
      )
        ? timestamp
        : null,
      durationSeconds:
        typeof latest.durationSeconds === "number"
          ? latest.durationSeconds
          : null,
      runtimeMetadata:
        typeof latest.runtimeMetadata === "object" &&
        latest.runtimeMetadata !== null
          ? (latest.runtimeMetadata as Record<string, unknown>)
          : {},
      notes: null,
    };

    mergeRecentSession(normalized);
  });

  $effect(() => {
    const latest = $systemHealth[0];
    if (!latest?.componentId) {
      return;
    }

    const normalized: ComponentHealth = {
      componentId: String(latest.componentId),
      componentName:
        typeof latest.componentName === "string"
          ? latest.componentName
          : undefined,
      status: String(latest.status ?? "unknown"),
      checkedAt:
        typeof latest.checkedAt === "string"
          ? latest.checkedAt
          : new Date().toISOString(),
      message: typeof latest.message === "string" ? latest.message : undefined,
    };

    mergeComponentHealthEntry(normalized);
  });

  function sessionTimestamp(session: RecentSession) {
    return session.completedAt ?? session.pausedAt ?? session.startedAt;
  }

  function shortId(value: string | null | undefined) {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    return raw.length > 10 ? raw.slice(0, 8) : raw;
  }

  const runningSessions = $derived(
    recentSessions.filter((session) => session.status === "running"),
  );
  const healthyComponents = $derived(
    componentHealth.filter((component) =>
      ["healthy", "running", "ready"].includes(component.status),
    ).length,
  );
  const componentsNeedingAttention = $derived(
    componentHealth.filter(
      (component) =>
        !["healthy", "running", "ready"].includes(component.status),
    ),
  );
  const latestSession = $derived(recentSessions[0] ?? null);
</script>

<PageHeader
  eyebrow="Ready to dig into some user studies?"
  title="Dashboard"
  description="View quick actions, component status, and currently active user studies."
/>

<div class="metric-grid">
  <SurfaceCard
    title="New user study"
    subtitle="Create and configure a new user study."
    icon="plus"
    href={appPath("/user-studies/new")}
    accent
  />
  <SurfaceCard
    title="View logs"
    subtitle="Browse and export collected data."
    icon="list"
    href={appPath("/session-logs")}
    accent
  />
  <SurfaceCard
    title="View user studies"
    subtitle="Browse user studies."
    icon="test-tube-diagonal"
    href={appPath("/user-studies")}
    accent
  />
  <SurfaceCard
    title="Manage researchers"
    subtitle="View and edit researchers."
    icon="user"
    href={appPath("/researchers")}
    accent
  />
</div>

<div class="mt-4 section-grid">
  <SurfaceCard title="Active User Studies">
    <div class="detail-grid-3">
      <div class="detail-panel">
        <p class="technical-label">Active studies</p>
        <p class="technical-value">{data.dashboard.activeStudies}</p>
      </div>
      <div class="detail-panel">
        <p class="technical-label">Total sessions</p>
        <p class="technical-value">{data.dashboard.totalSessions}</p>
      </div>
    </div>
    <div class="list-stack mt-4">
      {#each data.dashboard.activeStudyItems as study}
        {@const studySessions = recentSessions.filter((s) => String(s.studyId) === String(study.id))}
        <div class="entity-card">
          <div class="entity-card__header">
            <div class="min-w-0">
              <a class="entity-card__title truncate hover:underline" href={appPath(`/user-studies/${study.id}/overview`)}>{study.name}</a>
              {#if study.description}
                <p class="entity-card__meta truncate mt-1">{study.description}</p>
              {/if}
              <div class="pill-row mt-2">
                <span class="status-badge status-badge--soft"
                  >{study.participantCount} participant{study.participantCount === 1 ? "" : "s"}</span
                >
                <span class="status-badge status-badge--soft"
                  >{study.sessionCount} session{study.sessionCount === 1 ? "" : "s"}</span
                >
              </div>
            </div>
            <div class="flex items-center gap-2">
              <StatusBadge status={study.status} />
            </div>
          </div>

          {#if studySessions.length > 0}
            <div class="list-stack border-t border-[var(--scarline-border)] pt-4 mt-2">
              <p class="text-xs font-bold text-[var(--scarline-white-60)] uppercase tracking-wider mb-2">Recent Sessions</p>
              {#each studySessions as session}
                <a
                  class="entity-card entity-card--tight bg-transparent"
                  href={appPath(`/user-studies/${session.studyId}/active-study?sessionId=${session.id}`)}
                >
                  <div class="min-w-0">
                    <p class="entity-card__title truncate">
                      {session.name ?? `Session ${shortId(session.id)}`}
                    </p>
                    <p class="entity-card__meta truncate">
                      Participant {session.participantId ? shortId(session.participantId) : "unassigned"} · Last update {formatDate(sessionTimestamp(session))}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <StatusBadge status={session.status} />
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <EmptyState message="No studies are currently active." />
      {/each}
    </div>
    <div class="action-strip mt-4">
      <a href={appPath("/user-studies")}>View All</a>
    </div>
  </SurfaceCard>
</div>

<div class="mt-4 section-grid">
  <SurfaceCard title="Component Health">
    <div class="list-stack mt-4">
      {#each componentHealth as component}
        <div class="entity-card entity-card--tight">
          <div>
            <p class="entity-card__title">
              {component.componentName ?? component.componentId}
            </p>
            <p class="entity-card__meta">
              {formatDate(component.checkedAt)}
            </p>
          </div>
          <StatusBadge status={component.status} />
        </div>
      {:else}
        <EmptyState
          message="No component health events have been received yet."
        />
      {/each}
    </div>
  </SurfaceCard>
</div>

<div class="mt-4 section-grid">
  <SurfaceCard
    title="Operational Summary"
    subtitle="Monitor system state to determine your next steps."
  >
    <div class="content-stack">
      <div class="detail-panel">
        <p class="technical-label">Current session focus</p>
        {#if latestSession}
          <p class="technical-value">
            {latestSession.name ?? `Session ${shortId(latestSession.id)}`}
          </p>
          <p class="mt-2 text-sm text-slate-500">
            {data.dashboard.activeStudyItems.find((s) => String(s.id) === String(latestSession.studyId))?.name ?? `Study ${shortId(latestSession.studyId)}`} · Last update
            {formatDate(sessionTimestamp(latestSession))}
          </p>
        {:else}
          <p class="technical-value">No sessions have been created yet.</p>
        {/if}
      </div>

      <div class="detail-panel">
        <p class="technical-label">Attention needed</p>
        <p class="technical-value">
          {componentsNeedingAttention.length === 0
            ? "No components currently need attention."
            : `${componentsNeedingAttention.length} component${componentsNeedingAttention.length === 1 ? "" : "s"} require review.`}
        </p>
        {#if componentsNeedingAttention.length > 0}
          <div class="mt-3 flex flex-wrap gap-2">
            {#each componentsNeedingAttention.slice(0, 4) as component}
              <span class="status-badge status-badge--soft">
                {component.componentName ?? component.componentId}
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <div class="action-strip">
        <a href={appPath("/user-studies")}>Open studies</a>
        <a class="secondary" href={appPath("/session-logs")}>Inspect events</a>
      </div>
    </div>
  </SurfaceCard>
</div>

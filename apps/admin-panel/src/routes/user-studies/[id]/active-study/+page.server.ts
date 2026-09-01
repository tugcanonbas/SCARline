import { fail } from '@sveltejs/kit';
import { apiAction, apiRequest } from '$lib/server/api';
import { loadAdminLayouts } from '$lib/server/layouts';
import { sendOverlayCommand } from '$lib/server/overlay';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params, url }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const [sessionItems, context, overlayStatus] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken) as Promise<Array<Record<string, unknown>>>,
    loadAdminLayouts(fetch, locals, params.id),
    apiRequest(fetch, locals.apiBase, '/overlay/status', locals.accessToken) as Promise<Record<string, unknown>>
  ]);
  const sessions = await Promise.all(sessionItems.map(async (item) => {
    const detail = await apiRequest(fetch, locals.apiBase, `/sessions/${item.id}`, locals.accessToken) as Record<string, unknown>;
    const conditions = detail.conditions as Array<Record<string, unknown>> | undefined;
    const activeCondition = detail.activeCondition as Record<string, unknown> | null | undefined;
    const nextCondition = detail.nextCondition as Record<string, unknown> | null | undefined;
    return {
      ...detail,
      conditionId: activeCondition?.conditionId ?? nextCondition?.conditionId ?? conditions?.[0]?.conditionId ?? null,
      status: detail.status === 'aborted' ? 'cancelled' : detail.status
    };
  }));
  const participantLayout = context.layouts.find((layout) => layout.type === 'participant') ?? context.layouts[0] ?? null;
  const widgetNameById = new Map(context.catalogue.map((widget) => [widget.id, widget.name]));
  const triggerableWidgets = ((participantLayout?.widgets ?? []) as Array<Record<string, unknown>>).map((instance) => ({
    instanceId: instance.id, widgetId: instance.widgetId, name: widgetNameById.get(instance.widgetId) ?? instance.widgetId
  }));
  return {
    sessions: sessions as Array<Record<string, any>>,
    layouts: context.layouts,
    widgets: context.catalogue,
    triggerableWidgets,
    layoutDetail: participantLayout,
    participantLayoutsByCondition: context.participantLayoutsByCondition,
    webSocketOrigin: locals.webSocketOrigin,
    studyId: params.id,
    initialSelectedSessionId: url.searchParams.get('sessionId') ?? '',
    overlayStatus,
    canOperate: user.roles.some((role: string) => ['admin', 'researcher', 'operator'].includes(role))
  };
};

async function waitForLifecycleCommand(fetch: typeof globalThis.fetch, locals: App.Locals, commandId: string) {
  for (let attempt = 0; attempt < 350; attempt += 1) {
    const command = await apiRequest(fetch, locals.apiBase, `/session-commands/${commandId}`, locals.accessToken) as Record<string, unknown>;
    if (['completed', 'failed', 'timed_out'].includes(String(command.status))) return command;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { status: 'timed_out', errorMessage: 'The lifecycle command did not finish before the operator request timed out.' };
}

async function sessionAction(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  sessionId: string,
  action: string,
  options: { reason?: string | null; rendererMode?: string; hostId?: string | null } = {}
) {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
  const result = await apiAction(fetch, locals.apiBase, `/sessions/${sessionId}/${action}`, locals.accessToken, {
    method: 'POST', body: JSON.stringify({
      reason: options.reason ?? null,
      ...(options.rendererMode ? { rendererMode: options.rendererMode } : {}),
      ...(options.hostId ? { hostId: options.hostId } : {})
    })
  }, `Failed to ${action} session`);
  if (!result.ok) return result.failure;
  const command = await waitForLifecycleCommand(fetch, locals, String((result.data as Record<string, unknown>).commandId));
  if (command.status === 'completed') return { commandCompleted: true };
  return fail(command.status === 'timed_out' ? 504 : 409, {
    message: String(command.errorMessage ?? `The ${action} command failed.`),
    commandId: command.id ?? null
  });
}

export const actions = {
  start: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const form = await request.formData();
    const selectedSessionId = String(form.get('sessionId') ?? '');
    const rendererMode = form.get('rendererMode') === 'browser' ? 'browser' : 'desktop';
    const hostId = String(form.get('hostId') ?? '') || null;
    const session = await apiRequest(fetch, locals.apiBase, `/sessions/${selectedSessionId}`, locals.accessToken) as Record<string, unknown>;
    if (session.status === 'created') {
      const readyResult = await sessionAction(fetch, locals, selectedSessionId, 'ready');
      if (!('commandCompleted' in readyResult)) return readyResult;
    }
    return sessionAction(fetch, locals, selectedSessionId, 'start', { rendererMode, hostId });
  },
  pause: async ({ fetch, locals, request }) => sessionAction(fetch, locals, String((await request.formData()).get('sessionId')), 'pause'),
  resume: async ({ fetch, locals, request }) => sessionAction(fetch, locals, String((await request.formData()).get('sessionId')), 'resume'),
  advance: async ({ fetch, locals, request }) => sessionAction(fetch, locals, String((await request.formData()).get('sessionId')), 'advance'),
  complete: async ({ fetch, locals, request }) => sessionAction(fetch, locals, String((await request.formData()).get('sessionId')), 'complete'),
  abort: async ({ fetch, locals, request }) => {
    const form = await request.formData();
    return sessionAction(fetch, locals, String(form.get('sessionId')), 'abort', { reason: String(form.get('reason') ?? '') || null });
  },
  retryDesktop: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const form = await request.formData();
    const sessionId = String(form.get('sessionId') ?? '');
    const hostId = String(form.get('hostId') ?? '') || null;
    const result = await apiAction(fetch, locals.apiBase, `/sessions/${sessionId}/overlay/desktop`, locals.accessToken, {
      method: 'POST', body: JSON.stringify({ hostId })
    }, 'Failed to retry the desktop layout');
    return result.ok ? { desktopRetried: true } : result.failure;
  },
  note: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const form = await request.formData();
    const sessionId = String(form.get('sessionId') ?? '');
    const note = String(form.get('note') ?? '').trim();
    if (!sessionId || !note) return fail(400, { message: 'Select a session and enter a note before saving.' });
    const result = await apiAction(fetch, locals.apiBase, `/sessions/${sessionId}/annotations`, locals.accessToken, {
      method: 'POST', body: JSON.stringify({ text: note, category: 'operator-note', sessionConditionId: null, metadata: {} })
    }, 'Failed to save operator note');
    return result.ok ? { noteSaved: true } : result.failure;
  },
  trigger: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const form = await request.formData();
    const sessionId = String(form.get('sessionId') ?? '');
    const requestedAction = String(form.get('action') ?? 'manual-trigger');
    const action = requestedAction === 'manual-trigger' ? 'trigger' : requestedAction;
    const result = await apiAction(fetch, locals.apiBase, `/sessions/${sessionId}/widgets/trigger`, locals.accessToken, {
      method: 'POST', body: JSON.stringify({
        instanceId: form.get('instanceId'), action, bindingValues: {}
      })
    }, 'Failed to trigger widget');
    return result.ok ? undefined : result.failure;
  },
  windowUpdate: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const form = await request.formData();
    const sessionId = String(form.get('sessionId') ?? '');
    let windows: Array<Record<string, unknown>> = [];
    try { const parsed = JSON.parse(String(form.get('windows') ?? '[]')); if (Array.isArray(parsed)) windows = parsed; } catch { return fail(400, { message: 'Invalid window update payload' }); }
    for (const window of windows) {
      const instanceId = String(window.instanceId ?? '');
      const body = {
        expectedRevision: Math.round(Number(window.expectedRevision ?? 0)),
        windowMode: window.mode === 'browser_popup' ? 'browser_popup' : 'transparent_electron',
        inputMode: window.inputMode === 'interactive' ? 'interactive' : 'click_through',
        targetDisplay: String(window.targetDisplay ?? 'primary'),
        order: Math.max(0, Math.round(Number(window.order ?? 0))),
        x: Math.round(Number(window.x ?? 0)),
        y: Math.round(Number(window.y ?? 0)),
        width: Math.max(1, Math.round(Number(window.width ?? 180))),
        height: Math.max(1, Math.round(Number(window.height ?? 180))),
        enabled: window.enabled !== false,
        configuration: asRecord(window.configuration),
        bindingsConfig: asRecord(window.bindingsConfig),
        styleOverrides: asRecord(window.styleOverrides)
      };
      const persisted = await apiAction(fetch, locals.apiBase, `/sessions/${sessionId}/overlay/windows/${instanceId}`, locals.accessToken, {
        method: 'PUT', body: JSON.stringify(body)
      }, 'Failed to save the window change');
      if (!persisted.ok) return persisted.failure;
      try {
        await sendOverlayCommand(fetch, locals, {
          type: 'overlay.window.update',
          window: {
            instanceId,
            targetDisplay: body.targetDisplay,
            windowMode: body.windowMode,
            inputMode: body.inputMode,
            coordinateSpace: 'display-relative',
            x: body.x, y: body.y, width: body.width, height: body.height
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The live desktop update failed.';
        return fail(502, {
          saved: true,
          revision: Number((persisted.data as Record<string, unknown>).revision ?? body.expectedRevision + 1),
          message: `Window saved but not applied to the live desktop. ${message} Retry Apply.`
        });
      }
      return {
        windowUpdated: true,
        revision: Number((persisted.data as Record<string, unknown>).revision ?? body.expectedRevision + 1)
      };
    }
    return fail(400, { message: 'Select a window to update.' });
  }
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

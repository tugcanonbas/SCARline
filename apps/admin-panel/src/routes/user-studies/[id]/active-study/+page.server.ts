import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { fail } from '@sveltejs/kit';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  const sessions = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/sessions`, locals.accessToken);
  const layouts = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts`, locals.accessToken);
  const widgets = await apiRequest(fetch, locals.apiBase, '/widgets/catalogue', locals.accessToken);
  const participantLayout = layouts.find((layout: Record<string, unknown>) => layout.type === 'participant') ?? layouts[0] ?? null;
  const layoutDetail = participantLayout
    ? await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/layouts/${participantLayout.id}`, locals.accessToken)
    : null;
  const widgetNameById = new Map((widgets ?? []).map((widget: Record<string, unknown>) => [widget.id, widget.name]));
  const triggerableWidgets = (layoutDetail?.widgets ?? []).map((instance: Record<string, unknown>) => ({
    instanceId: instance.id,
    widgetId: instance.widgetId,
    name: widgetNameById.get(instance.widgetId) ?? instance.widgetId
  }));

  return {
    sessions,
    layouts,
    widgets,
    triggerableWidgets,
    layoutDetail,
    token: locals.accessToken,
    studyId: params.id
  };
};

async function postSessionAction(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  sessionId: string,
  action: string,
  body: Record<string, unknown> | null = null
) {
  const response = await fetch(`${locals.apiBase}/studies/${studyId}/sessions/${sessionId}/${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${locals.accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return fail(response.status, {
      message: payload?.error?.message ?? `Failed to ${action} session`
    });
  }

  return undefined;
}

async function configureTransparentOverlay(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string,
  sessionId: string
) {
  const layouts = await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/layouts`, locals.accessToken);
  const participantLayout = layouts.find((layout: Record<string, unknown>) => layout.type === 'participant') ?? layouts[0] ?? null;
  if (!participantLayout?.id) {
    return;
  }

  const session = await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/sessions/${sessionId}`, locals.accessToken);
  await apiRequest(fetch, locals.apiBase, '/system/overlay/configure', locals.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      studyId,
      sessionId,
      layoutId: participantLayout.id,
      conditionId: session?.conditionId ?? null
    })
  });
}

export const actions = {
  start: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const sessionId = String((await request.formData()).get('sessionId') ?? '');
    const result = await postSessionAction(fetch, locals, params.id, sessionId, 'start');
    if (result) return result;
    await configureTransparentOverlay(fetch, locals, params.id, sessionId);
    return undefined;
  },
  pause: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const sessionId = String((await request.formData()).get('sessionId') ?? '');
    return postSessionAction(fetch, locals, params.id, sessionId, 'pause');
  },
  resume: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const sessionId = String((await request.formData()).get('sessionId') ?? '');
    const result = await postSessionAction(fetch, locals, params.id, sessionId, 'resume');
    if (result) return result;
    await configureTransparentOverlay(fetch, locals, params.id, sessionId);
    return undefined;
  },
  complete: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const sessionId = String((await request.formData()).get('sessionId') ?? '');
    return postSessionAction(fetch, locals, params.id, sessionId, 'complete');
  },
  cancel: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const formData = await request.formData();
    const sessionId = String(formData.get('sessionId') ?? '');
    const reason = String(formData.get('reason') ?? '').trim() || null;
    return postSessionAction(fetch, locals, params.id, sessionId, 'cancel', { reason });
  },
  trigger: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator']);
    const formData = await request.formData();
    const sessionId = String(formData.get('sessionId') ?? '');
    const instanceId = String(formData.get('instanceId') ?? '');
    const widgetId = String(formData.get('widgetId') ?? '');
    const action = String(formData.get('action') ?? 'manual-trigger');
    const response = await fetch(`${locals.apiBase}/studies/${params.id}/sessions/${sessionId}/triggers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        instanceId,
        widgetId,
        triggerType: 'manual',
        source: 'researcher-trigger',
        bindingValues: {},
        payload: {
          action
        }
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, {
        message: payload?.error?.message ?? 'Failed to trigger widget'
      });
    }
    return undefined;
  }
};

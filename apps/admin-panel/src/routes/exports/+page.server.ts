import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { fail } from '@sveltejs/kit';

function stringOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

export const load = async ({ fetch, locals, url }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  const query = new URLSearchParams();
  for (const key of ['studyId', 'sessionId', 'status']) {
    const value = url.searchParams.get(key);
    if (value) query.set(key, value);
  }

  return {
    exports: await apiRequest(fetch, locals.apiBase, `/exports${query.size ? `?${query}` : ''}`, locals.accessToken),
    studies: await apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken),
    filters: {
      studyId: url.searchParams.get('studyId') ?? '',
      sessionId: url.searchParams.get('sessionId') ?? '',
      status: url.searchParams.get('status') ?? ''
    },
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

export const actions = {
  create: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const scope = String(formData.get('scope') ?? 'session');
    const result = await apiAction(fetch, locals.apiBase, '/exports', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        studyId: stringOrNull(formData.get('studyId')),
        sessionId: stringOrNull(formData.get('sessionId')),
        format: String(formData.get('format') ?? 'json'),
        scope,
        parameters: {}
      })
    }, 'Failed to create export');

    return result.ok ? undefined : result.failure;
  },
  delete: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const exportId = String(formData.get('exportId') ?? '');
    if (!exportId) {
      return fail(400, { message: 'Export id is required' });
    }

    const result = await apiAction(fetch, locals.apiBase, `/exports/${exportId}`, locals.accessToken, {
      method: 'DELETE'
    }, 'Failed to update export');

    return result.ok ? undefined : result.failure;
  }
};

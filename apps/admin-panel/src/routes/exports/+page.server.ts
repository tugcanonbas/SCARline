import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { fail } from '@sveltejs/kit';

function stringOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

export const load = async ({ fetch, locals, url }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
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
    // Separate from `filters` (which drives the existing-exports list) so a
    // deep link from a session log can pre-fill the Create Export form
    // without also filtering the list below it.
    prefillSessionId: url.searchParams.get('prefillSessionId') ?? '',
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

export const actions = {
  create: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const scope = String(formData.get('scope') ?? 'session');
    const format = String(formData.get('format') ?? 'json') === 'zip' ? 'both' : String(formData.get('format') ?? 'json');
    const targets = scope === 'all'
      ? (await apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken) as Array<Record<string, unknown>>).map((study) => ({ scope: 'study', targetId: study.id }))
      : [{ scope, targetId: scope === 'session' ? stringOrNull(formData.get('sessionId')) : stringOrNull(formData.get('studyId')) }];
    if (targets.length === 0 || targets.some((target) => !target.targetId)) return fail(400, { message: 'Select an export target.' });
    for (const target of targets) {
      const result = await apiAction(fetch, locals.apiBase, '/exports', locals.accessToken, {
        method: 'POST',
        body: JSON.stringify({ ...target, format, pseudonymize: true, includeDemographics: false })
      }, 'Failed to create export');
      if (!result.ok) return result.failure;
    }
    return undefined;
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

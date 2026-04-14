import { redirect } from '@sveltejs/kit';
import { apiAction } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { appPath } from '$lib/paths';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {};
};

export const actions = {
  default: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const result = await apiAction(fetch, locals.apiBase, '/researchers', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        institution: formData.get('institution') || null,
        role: formData.get('role') || null,
        email: formData.get('email') || null,
        phone: formData.get('phone') || null,
        notes: formData.get('notes') || null
      })
    }, 'Failed to create researcher');
    if (!result.ok) return result.failure;

    throw redirect(303, appPath(`/researchers/${result.data.id}`));
  }
};

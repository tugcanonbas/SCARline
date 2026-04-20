import { redirect } from '@sveltejs/kit';
import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { appPath } from '$lib/paths';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {
    researcher: await apiRequest(fetch, locals.apiBase, `/researchers/${params.id}`, locals.accessToken),
    studies: await apiRequest(fetch, locals.apiBase, `/researchers/${params.id}/studies`, locals.accessToken)
  };
};

export const actions = {
  update: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, `/researchers/${params.id}`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        name: formData.get('name'),
        institution: formData.get('institution') || null,
        role: formData.get('role') || null,
        email: formData.get('email') || null,
        phone: formData.get('phone') || null,
        notes: formData.get('notes') || null
      })
    });
  },
  delete: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    await apiRequest(fetch, locals.apiBase, `/researchers/${params.id}`, locals.accessToken, {
      method: 'DELETE'
    });
    throw redirect(303, appPath('/researchers'));
  }
};

import { redirect } from '@sveltejs/kit';
import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { appPath } from '$lib/paths';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  const [user, studies] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/users/${params.id}`, locals.accessToken) as Promise<Record<string, unknown>>,
    apiRequest(fetch, locals.apiBase, '/studies', locals.accessToken) as Promise<Array<Record<string, unknown>>>
  ]);
  const assigned = (await Promise.all(studies.map(async (study) => {
    const users = await apiRequest(fetch, locals.apiBase, `/studies/${study.id}/users`, locals.accessToken) as Array<Record<string, unknown>>;
    return users.some((entry) => entry.id === params.id) ? { ...study, assignment_role: 'member' } : null;
  }))).filter(Boolean) as Array<Record<string, unknown>>;
  return {
    researcher: { ...user, name: String(user.displayName ?? ''), role: 'Researcher', phone: null, notes: null } as Record<string, any>,
    studies: assigned as Array<Record<string, any>>
  };
};

export const actions = {
  update: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, `/users/${params.id}`, locals.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: formData.get('name'),
        institution: formData.get('institution') || null,
        email: formData.get('email') || null
      })
    });
  },
  delete: async ({ fetch, locals, params }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    await apiRequest(fetch, locals.apiBase, `/users/${params.id}`, locals.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false, disabledReason: 'Deactivated by an administrator' })
    });
    throw redirect(303, appPath('/researchers'));
  }
};

import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

const VALID_ROLES = ['admin', 'researcher', 'operator', 'viewer'];

function stringOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

function rolesFromForm(formData: FormData) {
  const roles = formData.getAll('roles').map(String).filter((role) => VALID_ROLES.includes(role));
  return roles.length ? roles : ['viewer'];
}

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  return {
    users: await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken),
    researchers: await apiRequest(fetch, locals.apiBase, '/researchers', locals.accessToken)
  };
};

export const actions = {
  create: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        researcherId: stringOrNull(formData.get('researcherId')),
        username: stringOrNull(formData.get('username')),
        password: String(formData.get('password') ?? ''),
        displayName: stringOrNull(formData.get('displayName')),
        email: stringOrNull(formData.get('email')),
        roles: rolesFromForm(formData)
      })
    });
  },
  update: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    const password = String(formData.get('password') ?? '').trim();
    await apiRequest(fetch, locals.apiBase, `/users/${String(formData.get('userId'))}`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        researcherId: stringOrNull(formData.get('researcherId')),
        displayName: stringOrNull(formData.get('displayName')),
        email: stringOrNull(formData.get('email')),
        isActive: formData.get('isActive') === 'on',
        password: password || undefined,
        roles: rolesFromForm(formData)
      })
    });
  },
  deactivate: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, `/users/${String(formData.get('userId'))}`, locals.accessToken, {
      method: 'DELETE'
    });
  }
};

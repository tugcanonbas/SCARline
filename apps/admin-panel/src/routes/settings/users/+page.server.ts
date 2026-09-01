import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

const VALID_ROLES = ['admin', 'researcher', 'operator', 'observer'];

function stringOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

function rolesFromForm(formData: FormData) {
  const roles = formData.getAll('roles').map(String).filter((role) => VALID_ROLES.includes(role));
  return roles.length ? roles : ['observer'];
}

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  const users = await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken) as Array<Record<string, unknown>>;
  return {
    users: users as Array<Record<string, any>>,
    researchers: [] as Array<Record<string, any>>
  };
};

export const actions = {
  create: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, '/users', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
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
      method: 'PATCH',
      body: JSON.stringify({
        displayName: stringOrNull(formData.get('displayName')),
        email: stringOrNull(formData.get('email')),
        isActive: formData.get('isActive') === 'on',
        disabledReason: formData.get('isActive') === 'on' ? undefined : 'Deactivated by an administrator',
        roles: rolesFromForm(formData)
      })
    });
    if (password) {
      await apiRequest(fetch, locals.apiBase, `/users/${String(formData.get('userId'))}/reset-password`, locals.accessToken, {
        method: 'POST',
        body: JSON.stringify({ temporaryPassword: password })
      });
    }
  },
  deactivate: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, `/users/${String(formData.get('userId'))}`, locals.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false, disabledReason: 'Deactivated by an administrator' })
    });
  }
};

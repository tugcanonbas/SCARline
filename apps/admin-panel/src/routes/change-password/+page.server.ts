import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { clearAuthSession } from '$lib/server/auth';

export const actions = {
  default: async (event) => {
    if (!event.locals.accessToken) throw redirect(303, appPath('/login'));
    const formData = await event.request.formData();
    const currentPassword = String(formData.get('currentPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');
    if (newPassword !== confirmation) return fail(400, { message: 'New passwords do not match.' });
    const response = await event.fetch(`${event.locals.apiBase}/auth/change-password`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${event.locals.accessToken}`,
        'content-type': 'application/json',
        origin: event.url.origin
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, { message: payload?.error?.message ?? 'Password change failed.' });
    }
    clearAuthSession(event);
    throw redirect(303, appPath('/login'));
  }
};

import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';

export const actions = {
  default: async ({ fetch, locals, request }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/onboarding/researcher`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        fullName: formData.get('fullName'),
        email: formData.get('email') || undefined,
        institution: formData.get('institution') || undefined,
        role: formData.get('role') || undefined,
        username: formData.get('username'),
        password: formData.get('password')
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, {
        message: payload?.error?.message ?? 'Failed to create the first admin account'
      });
    }

    throw redirect(303, appPath('/login'));
  }
};

import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';

export const actions = {
  default: async ({ fetch, locals, request }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/onboarding/system`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        carlaServerPath: formData.get('carlaServerPath') || null,
        dataDirectory: formData.get('dataDirectory'),
        platformPort: Number(formData.get('platformPort')),
        carlaServerPort: Number(formData.get('carlaServerPort')),
        transparentOverlayEnabled: formData.get('transparentOverlayEnabled') === 'on'
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, {
        message: payload?.error?.message ?? 'Failed to save system configuration'
      });
    }

    throw redirect(303, appPath('/onboarding/researcher'));
  }
};

import { redirect } from '@sveltejs/kit';

export const actions = {
  default: async ({ fetch, locals, request }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/studies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || undefined
      })
    });
    const payload = await response.json();
    throw redirect(303, `/user-studies/${payload.data.id}/overview`);
  }
};

import { fail, redirect } from '@sveltejs/kit';
import { getBootstrapState } from '$lib/server/bootstrap';

export const load = async ({ cookies, fetch, locals, url }) => {
  if (url.searchParams.get('logout') === '1') {
    cookies.delete('scarline_access_token', { path: '/' });
    cookies.delete('scarline_refresh_token', { path: '/' });
  }

  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  if (!bootstrap.onboardingCompleted) {
    throw redirect(303, '/onboarding/system');
  }

  if (locals.accessToken) {
    throw redirect(303, '/dashboard');
  }
};

export const actions = {
  default: async ({ fetch, locals, request, cookies }) => {
    const formData = await request.formData();
    const response = await fetch(`${locals.apiBase}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password')
      })
    });

    if (!response.ok) {
      return fail(401, {
        message: 'Invalid username or password'
      });
    }

    const payload = await response.json();
    cookies.set('scarline_access_token', payload.data.accessToken, { path: '/', httpOnly: true, sameSite: 'lax' });
    cookies.set('scarline_refresh_token', payload.data.refreshToken, { path: '/', httpOnly: true, sameSite: 'lax' });
    throw redirect(303, '/dashboard');
  }
};

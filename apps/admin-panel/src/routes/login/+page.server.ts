import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { clearAuthSession, getAuthCookieOptions, resolvePostLoginRedirect, sanitizeRedirectTarget } from '$lib/server/auth';
import { getBootstrapState } from '$lib/server/bootstrap';

export const load = async ({ cookies, fetch, locals, url }) => {
  if (url.searchParams.get('logout') === '1') {
    const refreshToken = cookies.get('scarline_refresh_token');
    if (refreshToken) {
      await fetch(`${locals.apiBase}/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      }).catch(() => undefined);
    }

    clearAuthSession({ cookies, locals });
  }

  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  if (!bootstrap.onboardingCompleted) {
    throw redirect(303, appPath('/onboarding/system'));
  }

  if (locals.accessToken && url.searchParams.get('logout') !== '1') {
    throw redirect(303, appPath(resolvePostLoginRedirect(url)));
  }

  return {
    redirectTo: sanitizeRedirectTarget(url.searchParams.get('redirectTo'))
  };
};

export const actions = {
  default: async ({ fetch, locals, request, cookies, url }) => {
    const formData = await request.formData();
    const redirectTo = sanitizeRedirectTarget(String(formData.get('redirectTo') ?? '')) ?? resolvePostLoginRedirect(url);
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
    const cookieOptions = getAuthCookieOptions();
    cookies.set('scarline_access_token', payload.data.accessToken, cookieOptions);
    cookies.set('scarline_refresh_token', payload.data.refreshToken, cookieOptions);
    throw redirect(303, appPath(redirectTo));
  }
};

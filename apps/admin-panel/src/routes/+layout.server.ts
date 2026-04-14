import { error, redirect } from '@sveltejs/kit';
import { appPath, stripAppBase } from '$lib/paths';
import { getBootstrapState, resolveRouteGuardRedirect } from '$lib/server/bootstrap';

export const load = async ({ fetch, locals, url }) => {
  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  if (!bootstrap.available && locals.accessToken) {
    throw error(503, 'CoreAPI is unavailable. Please check the SCARline stack and try again.');
  }

  const target = resolveRouteGuardRedirect({
    pathname: stripAppBase(url.pathname),
    onboardingCompleted: bootstrap.onboardingCompleted,
    isAuthenticated: Boolean(locals.accessToken)
  });

  if (target) {
    throw redirect(303, appPath(target));
  }

  let user = null;
  if (locals.accessToken) {
    const response = await fetch(`${locals.apiBase}/auth/me`, {
      headers: {
        authorization: `Bearer ${locals.accessToken}`
      }
    });

    if (response.ok) {
      const payload = await response.json();
      user = payload.data;
    }
  }

  return {
    user,
    isAuthenticated: Boolean(locals.accessToken),
    onboardingCompleted: bootstrap.onboardingCompleted
  };
};

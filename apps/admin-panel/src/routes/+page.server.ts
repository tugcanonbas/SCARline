import { redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import { getBootstrapState, resolveIndexRedirect } from '$lib/server/bootstrap';

export const load = async ({ fetch, locals }) => {
  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  throw redirect(
    303,
    appPath(resolveIndexRedirect({
      onboardingCompleted: bootstrap.onboardingCompleted,
      isAuthenticated: Boolean(locals.accessToken)
    }))
  );
};

import { redirect } from '@sveltejs/kit';
import { getBootstrapState, resolveIndexRedirect } from '$lib/server/bootstrap';

export const load = async ({ fetch, locals }) => {
  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  throw redirect(
    303,
    resolveIndexRedirect({
      onboardingCompleted: bootstrap.onboardingCompleted,
      isAuthenticated: Boolean(locals.accessToken)
    })
  );
};

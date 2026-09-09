import { getBootstrapState } from '$lib/server/bootstrap';

export const load = async ({ fetch, locals }) => {
  const bootstrap = await getBootstrapState(fetch, locals.apiBase);
  return {
    health: bootstrap.health,
    bootstrap
  };
};

import { redirect } from '@sveltejs/kit';
import { stripAppBase } from '$lib/paths';
import { clearAuthSession, createLoginRedirectPath } from '$lib/server/auth';

export const handle = async ({ event, resolve }) => {
  event.locals.accessToken = event.cookies.get('scarline_access_token') ?? null;
  event.locals.refreshToken = event.cookies.get('scarline_refresh_token') ?? null;
  event.locals.apiBase = process.env.CORE_API_ORIGIN ?? process.env.PUBLIC_API_BASE ?? '/api';
  return resolve(event);
};

export const handleFetch = async ({ event, request, fetch }) => {
  const response = await fetch(request);

  if (!event.locals.accessToken || response.status !== 401) {
    return response;
  }

  const apiPathname = new URL(event.locals.apiBase, event.url).pathname;
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.startsWith(apiPathname)) {
    return response;
  }

  clearAuthSession(event);
  if (stripAppBase(event.url.pathname) === '/login') {
    return response;
  }

  throw redirect(303, createLoginRedirectPath(event.url));
};

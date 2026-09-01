import type { Handle, HandleFetch } from '@sveltejs/kit';
import { ACCESS_TOKEN_COOKIE_NAME, clearAuthSession, refreshAuthSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.apiBase = process.env.CORE_API_ORIGIN ?? 'http://127.0.0.1:8088/api/v1';
  event.locals.publicApiBase = process.env.PUBLIC_CORE_API_ORIGIN ?? 'http://127.0.0.1:8088/api/v1';
  event.locals.webSocketOrigin = process.env.PUBLIC_CORE_API_WEBSOCKET_ORIGIN ?? 'ws://127.0.0.1:8088';
  event.locals.accessToken = event.cookies.get(ACCESS_TOKEN_COOKIE_NAME) ?? null;
  if (!event.locals.accessToken) {
    await refreshAuthSession(event).catch(() => clearAuthSession(event));
  }
  return resolve(event);
};

export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
  const retryRequest = request.clone();
  const response = await fetch(request);
  if (response.status !== 401 || !request.url.startsWith(event.locals.apiBase)) return response;
  if (!(await refreshAuthSession(event).catch(() => false)) || !event.locals.accessToken) return response;
  const headers = new Headers(retryRequest.headers);
  headers.set('authorization', `Bearer ${event.locals.accessToken}`);
  return fetch(new Request(retryRequest, { headers }));
};

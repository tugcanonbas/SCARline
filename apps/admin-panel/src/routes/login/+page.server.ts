import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';
import {
  captureRefreshCookie,
  logoutAuthSession,
  resolvePostLoginRedirect,
  sanitizeRedirectTarget,
  setAccessSession
} from '$lib/server/auth';

export const load = async (event) => {
  if (event.url.searchParams.get('logout') === '1') await logoutAuthSession(event);
  if (event.locals.accessToken && event.url.searchParams.get('logout') !== '1') {
    throw redirect(303, appPath(resolvePostLoginRedirect(event.url)));
  }
  return { redirectTo: sanitizeRedirectTarget(event.url.searchParams.get('redirectTo')) };
};

export const actions = {
  default: async (event) => {
    const formData = await event.request.formData();
    const redirectTo = sanitizeRedirectTarget(String(formData.get('redirectTo') ?? '')) ?? resolvePostLoginRedirect(event.url);
    const response = await globalThis.fetch(`${event.locals.apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: event.url.origin },
      body: JSON.stringify({ username: formData.get('username'), password: formData.get('password') })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data) return fail(response.status || 401, { message: 'Invalid username or password' });
    const user = setAccessSession(event.cookies, payload.data);
    captureRefreshCookie(response, event.cookies);
    event.locals.accessToken = payload.data.accessToken;
    throw redirect(303, appPath(user.passwordResetRequired ? '/change-password' : redirectTo));
  }
};

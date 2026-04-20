import { type RequestEvent } from '@sveltejs/kit';
import { appPath, stripAppBase } from '$lib/paths';

const AUTH_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production'
};

export function getAuthCookieOptions() {
  return AUTH_COOKIE_OPTIONS;
}

export function clearAuthSession({ cookies, locals }: Pick<RequestEvent, 'cookies' | 'locals'>) {
  cookies.delete('scarline_access_token', { path: '/' });
  cookies.delete('scarline_refresh_token', { path: '/' });
  locals.accessToken = null;
  locals.refreshToken = null;
}

export function sanitizeRedirectTarget(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
    return null;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutHash = normalized.split('#', 1)[0] ?? normalized;
  const stripped = stripAppBase(withoutHash);

  if (!stripped.startsWith('/') || stripped === '/login' || stripped.startsWith('/login?')) {
    return null;
  }

  return stripped;
}

export function getRequestRedirectTarget(url: URL): string {
  return sanitizeRedirectTarget(`${stripAppBase(url.pathname)}${url.search}`) ?? '/';
}

export function createLoginRedirectPath(url: URL): string {
  const redirectTo = getRequestRedirectTarget(url);
  const searchParams = new URLSearchParams({ redirectTo });
  return appPath(`/login?${searchParams.toString()}`);
}

export function resolvePostLoginRedirect(url: URL, fallback = '/dashboard'): string {
  return sanitizeRedirectTarget(url.searchParams.get('redirectTo')) ?? fallback;
}

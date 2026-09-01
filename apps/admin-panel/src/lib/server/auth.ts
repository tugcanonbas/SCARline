import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import {
  AccessTokenResponseSchema,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_OPTIONS
} from '@scarline/contracts';
import { appPath, stripAppBase } from '$lib/paths';
import { SingleFlightCache } from '$lib/server/single-flight';

export const ACCESS_TOKEN_COOKIE_NAME = 'scarline_access_token';

const ACCESS_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: true,
  priority: 'high' as const
};

interface RefreshResult {
  readonly ok: boolean;
  readonly payload: unknown;
  readonly setCookie: string | null;
}

// SvelteKit requests can arrive concurrently when an access cookie expires.
// Reuse one rotation result briefly so CoreAPI never sees the same refresh
// token twice and mistakes normal browser concurrency for token theft.
const refreshFlights = new SingleFlightCache<RefreshResult>(2_000);

export function clearAuthSession({ cookies, locals }: Pick<RequestEvent, 'cookies' | 'locals'>) {
  cookies.delete(ACCESS_TOKEN_COOKIE_NAME, ACCESS_COOKIE_OPTIONS);
  cookies.delete(REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS);
  locals.accessToken = null;
}

export function setAccessSession(cookies: Cookies, value: unknown): App.AuthenticatedUser {
  const parsed = AccessTokenResponseSchema.parse(value);
  cookies.set(ACCESS_TOKEN_COOKIE_NAME, parsed.accessToken, {
    ...ACCESS_COOKIE_OPTIONS,
    expires: new Date(parsed.accessTokenExpiresAt)
  });
  return parsed.user;
}

export function captureRefreshCookie(response: Response, cookies: Cookies): void {
  captureRefreshCookieValue(response.headers.get('set-cookie'), cookies);
}

function captureRefreshCookieValue(raw: string | null, cookies: Cookies): void {
  if (!raw) return;
  const cookie = raw.split(';', 1)[0] ?? '';
  const separator = cookie.indexOf('=');
  if (separator < 0 || cookie.slice(0, separator) !== REFRESH_TOKEN_COOKIE_NAME) return;
  const value = cookie.slice(separator + 1);
  if (!value) {
    cookies.delete(REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS);
    return;
  }
  const maxAgeMatch = raw.match(/(?:^|;)\s*Max-Age=(\d+)/i);
  cookies.set(REFRESH_TOKEN_COOKIE_NAME, value, {
    ...REFRESH_TOKEN_COOKIE_OPTIONS,
    ...(maxAgeMatch ? { maxAge: Number(maxAgeMatch[1]) } : {})
  });
}

function authHeaders(event: Pick<RequestEvent, 'url'>, includeCookie?: string): HeadersInit {
  return {
    'content-type': 'application/json',
    origin: event.url.origin,
    ...(includeCookie ? { cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${includeCookie}` } : {})
  };
}

export async function refreshAuthSession(event: RequestEvent): Promise<boolean> {
  const refreshToken = event.cookies.get(REFRESH_TOKEN_COOKIE_NAME);
  if (!refreshToken) return false;
  const key = createHash('sha256').update(refreshToken).digest('base64url');
  const result = await refreshFlights.run(key, async () => {
    const response = await globalThis.fetch(`${event.locals.apiBase}/auth/refresh`, {
      method: 'POST',
      headers: authHeaders(event, refreshToken),
      body: '{}'
    });
    return {
      ok: response.ok,
      payload: await response.json().catch(() => null),
      setCookie: response.headers.get('set-cookie')
    };
  });
  if (!result.ok) {
    clearAuthSession(event);
    return false;
  }
  const payload = result.payload as { data?: unknown };
  setAccessSession(event.cookies, payload.data);
  captureRefreshCookieValue(result.setCookie, event.cookies);
  event.locals.accessToken = AccessTokenResponseSchema.parse(payload.data).accessToken;
  return true;
}

export async function logoutAuthSession(event: RequestEvent): Promise<void> {
  const refreshToken = event.cookies.get(REFRESH_TOKEN_COOKIE_NAME);
  if (refreshToken) {
    await globalThis.fetch(`${event.locals.apiBase}/auth/logout`, {
      method: 'POST',
      headers: authHeaders(event, refreshToken),
      body: '{}'
    }).catch(() => undefined);
  }
  clearAuthSession(event);
}

export function sanitizeRedirectTarget(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) return null;
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutHash = normalized.split('#', 1)[0] ?? normalized;
  const stripped = stripAppBase(withoutHash);
  if (!stripped.startsWith('/') || stripped === '/login' || stripped.startsWith('/login?')) return null;
  return stripped;
}

export function getRequestRedirectTarget(url: URL): string {
  return sanitizeRedirectTarget(`${stripAppBase(url.pathname)}${url.search}`) ?? '/';
}

export function createLoginRedirectPath(url: URL): string {
  const searchParams = new URLSearchParams({ redirectTo: getRequestRedirectTarget(url) });
  return appPath(`/login?${searchParams.toString()}`);
}

export function resolvePostLoginRedirect(url: URL, fallback = '/dashboard'): string {
  return sanitizeRedirectTarget(url.searchParams.get('redirectTo')) ?? fallback;
}

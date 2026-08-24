import { error, fail } from '@sveltejs/kit';

export async function apiRequest(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  path: string,
  token: string | null,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw error(response.status, payload?.error?.message ?? 'Request failed');
  }

  return payload?.data ?? payload;
}

export async function apiAction(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  path: string,
  token: string | null,
  init: RequestInit = {},
  fallbackMessage = 'Request failed'
) {
  const headers = new Headers(init.headers);
  // Only set Content-Type when a body is present — sending this header with an empty
  // body causes Fastify's JSON body parser to reject the request with a 400 error.
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false as const,
      failure: fail(response.status, {
        message: payload?.error?.message ?? fallbackMessage
      })
    };
  }

  return {
    ok: true as const,
    data: payload?.data ?? payload
  };
}

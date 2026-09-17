import { error, fail } from '@sveltejs/kit';

// Route adapters intentionally accept multiple CoreAPI response shapes while
// the migrated screens retain their existing view models.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapPayload(payload: any): any {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: unknown }).data
    : payload;
  if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items)) {
    return (data as { items: unknown[] }).items;
  }
  return data;
}

export async function apiRequest(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  path: string,
  token: string | null,
  init: RequestInit = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw error(response.status, typeof payload?.error?.message === 'string' && response.status < 500 ? payload.error.message : 'Request failed');
  }

  return unwrapPayload(payload);
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
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false as const,
      failure: fail(response.status, {
        message: typeof payload?.error?.message === 'string' && response.status < 500
          ? payload.error.message
          : fallbackMessage
      })
    };
  }

  return {
    ok: true as const,
    data: unwrapPayload(payload)
  };
}

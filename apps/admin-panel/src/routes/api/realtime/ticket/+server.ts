import { error, json } from '@sveltejs/kit';

import { apiRequest } from '$lib/server/api';

export const POST = async ({ fetch, locals, request, url }) => {
  if (!locals.accessToken) throw error(401, 'Authentication required');
  if (request.headers.get('origin') !== url.origin) throw error(403, 'Request origin is not allowed');

  const ticket = await apiRequest(
    fetch,
    locals.apiBase,
    '/auth/websocket-ticket',
    locals.accessToken,
    { method: 'POST', body: '{}' }
  ) as { token: string; expiresAt: string };

  return json(
    { data: ticket },
    { headers: { 'cache-control': 'no-store, private' } }
  );
};

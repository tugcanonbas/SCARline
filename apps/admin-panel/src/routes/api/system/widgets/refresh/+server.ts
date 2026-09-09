import { json } from '@sveltejs/kit';

import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const POST = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  const result = await apiRequest(
    fetch,
    locals.apiBase,
    '/widgets/refresh',
    locals.accessToken,
    { method: 'POST', body: '{}' }
  ) as Record<string, unknown>;
  return json({ data: result });
};

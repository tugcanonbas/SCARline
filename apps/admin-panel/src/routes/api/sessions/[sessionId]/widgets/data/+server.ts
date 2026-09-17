import { error, json } from '@sveltejs/kit';
import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const GET = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  if (!/^[0-9a-f-]{36}$/i.test(params.sessionId)) error(400, 'Invalid session');
  const data = await apiRequest(fetch, locals.apiBase,
    `/sessions/${params.sessionId}/widgets/data`, locals.accessToken);
  return json({ data }, { headers: { 'cache-control': 'no-store' } });
};

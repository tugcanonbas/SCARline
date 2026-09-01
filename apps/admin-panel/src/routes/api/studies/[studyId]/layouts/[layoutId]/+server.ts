import { json } from '@sveltejs/kit';
import { LayoutPersistenceError, persistAdminLayout } from '$lib/server/layouts';

export const PUT = async ({ fetch, locals, params, request }) => {
  try {
    const body = await request.json() as Record<string, unknown>;
    const data = await persistAdminLayout(fetch, locals, params.studyId, body, params.layoutId);
    return json({ data });
  } catch (cause) {
    if (cause instanceof LayoutPersistenceError) {
      return json({ error: { code: cause.code, message: cause.message, details: cause.details } }, { status: cause.status });
    }
    throw cause;
  }
};

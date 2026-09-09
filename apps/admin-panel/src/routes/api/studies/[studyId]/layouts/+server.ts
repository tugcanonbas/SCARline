import { json } from '@sveltejs/kit';
import { LayoutPersistenceError, loadAdminLayouts, persistAdminLayout } from '$lib/server/layouts';

export const GET = async ({ fetch, locals, params }) => {
  const context = await loadAdminLayouts(fetch, locals, params.studyId);
  return json({ data: context.layouts });
};

export const POST = async ({ fetch, locals, params, request }) => {
  try {
    const body = await request.json() as Record<string, unknown>;
    const data = await persistAdminLayout(fetch, locals, params.studyId, body);
    return json({ data }, { status: 201 });
  } catch (cause) {
    if (cause instanceof LayoutPersistenceError) {
      return json({ error: { code: cause.code, message: cause.message, details: cause.details } }, { status: cause.status });
    }
    throw cause;
  }
};

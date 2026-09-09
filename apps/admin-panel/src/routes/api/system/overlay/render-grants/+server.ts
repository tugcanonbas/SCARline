import { json } from '@sveltejs/kit';
import { createOverlayRenderGrant } from '$lib/server/overlay';

export const POST = async ({ fetch, locals, request }) => {
  const body = await request.json() as Record<string, unknown>;
  const data = await createOverlayRenderGrant(fetch, locals, {
    rendererMode: body.rendererMode === 'desktop' ? 'desktop' : 'browser',
    layoutId: body.layoutId,
    instanceId: body.instanceId ?? null,
    sessionId: body.sessionId ?? null
  });
  return json({ data }, { status: 201 });
};

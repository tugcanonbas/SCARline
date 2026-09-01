import { json } from '@sveltejs/kit';
import { loadAdminLayouts } from '$lib/server/layouts';
import { sendOverlayCommand } from '$lib/server/overlay';

export const POST = async ({ fetch, locals, request }) => {
  const body = await request.json() as Record<string, unknown>;
  let ids = Array.isArray(body.instanceIds) ? body.instanceIds.map(String) : [];
  if (body.closeAll === true && typeof body.studyId === 'string') {
    const context = await loadAdminLayouts(fetch, locals, body.studyId);
    const layout = typeof body.layoutId === 'string'
      ? context.layouts.find((entry) => entry.id === body.layoutId)
      : context.layouts.find((entry) => entry.type === 'participant');
    ids = ((layout?.widgets ?? []) as Array<Record<string, unknown>>).map((widget) => String(widget.id));
  }
  for (const instanceId of ids) await sendOverlayCommand(fetch, locals, { type: 'overlay.window.close', instanceId });
  return json({ data: { closed: ids.length } }, { status: 202 });
};

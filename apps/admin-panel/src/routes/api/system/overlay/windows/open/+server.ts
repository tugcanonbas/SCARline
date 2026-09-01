import { json } from '@sveltejs/kit';
import { sendOverlayCommand } from '$lib/server/overlay';

export const POST = async ({ fetch, locals, request }) => {
  const body = await request.json() as Record<string, unknown>;
  const bounds = (body.bounds ?? {}) as Record<string, unknown>;
  const data = await sendOverlayCommand(fetch, locals, {
    type: 'overlay.window.open',
    window: {
      instanceId: body.instanceId,
      targetDisplay: String(body.targetDisplay ?? 'primary'),
      windowMode: 'transparent_electron',
      coordinateSpace: 'display-relative',
      x: Math.round(Number(bounds.x ?? 0)), y: Math.round(Number(bounds.y ?? 0)),
      width: Math.max(1, Math.round(Number(bounds.width ?? 180))),
      height: Math.max(1, Math.round(Number(bounds.height ?? 180)))
    }
  });
  return json({ data }, { status: 202 });
};

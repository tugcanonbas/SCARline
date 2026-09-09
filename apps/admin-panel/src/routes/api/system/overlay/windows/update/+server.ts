import { json } from '@sveltejs/kit';
import { sendOverlayCommand } from '$lib/server/overlay';

export const POST = async ({ fetch, locals, request }) => {
  const body = await request.json() as Record<string, unknown>;
  const windows = Array.isArray(body.windows) ? body.windows as Array<Record<string, unknown>> : [];
  for (const window of windows) {
    const bounds = window.bounds && typeof window.bounds === 'object'
      ? window.bounds as Record<string, unknown>
      : {};
    await sendOverlayCommand(fetch, locals, {
      type: 'overlay.window.update',
      window: {
        instanceId: window.instanceId,
        targetDisplay: String(window.targetDisplay ?? 'primary'),
        windowMode: window.windowMode === 'browser_popup' ? 'browser_popup' : 'transparent_electron',
        inputMode: window.inputMode === 'interactive' ? 'interactive' : 'click_through',
        coordinateSpace: 'display-relative',
        x: Math.round(Number(bounds.x ?? 0)),
        y: Math.round(Number(bounds.y ?? 0)),
        width: Math.max(1, Math.round(Number(bounds.width ?? 180))),
        height: Math.max(1, Math.round(Number(bounds.height ?? 180)))
      }
    });
  }
  return json({ data: { updated: windows.length } });
};

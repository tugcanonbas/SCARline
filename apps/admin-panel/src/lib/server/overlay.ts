import { error } from '@sveltejs/kit';

export async function sendOverlayCommand(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  command: Record<string, unknown>
) {
  if (!locals.accessToken) throw error(401, 'Authentication required');
  const response = await fetch(`${locals.apiBase}/overlay/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${locals.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw error(response.status, payload?.error?.message ?? 'Overlay command failed');
  return payload?.data ?? payload;
}

export async function createOverlayRenderGrant(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  grant: Record<string, unknown>
) {
  if (!locals.accessToken) throw error(401, 'Authentication required');
  const response = await fetch(`${locals.apiBase}/overlay/render-grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${locals.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(grant)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw error(response.status, payload?.error?.message ?? 'Overlay grant failed');
  return payload?.data ?? payload;
}

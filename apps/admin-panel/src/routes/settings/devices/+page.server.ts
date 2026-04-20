import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';
import { error } from '@sveltejs/kit';

function stringOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseJsonObject(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw error(400, 'Expected a JSON object');
    }

    return parsed;
  } catch (parseError) {
    if (parseError && typeof parseError === 'object' && 'status' in parseError) {
      throw parseError;
    }
    throw error(400, 'Invalid JSON object');
  }
}

export const load = async ({ fetch, locals, url }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  const query = new URLSearchParams();
  const type = url.searchParams.get('type');
  const status = url.searchParams.get('status');
  if (type) query.set('type', type);
  if (status) query.set('status', status);

  return {
    devices: await apiRequest(fetch, locals.apiBase, `/devices${query.size ? `?${query}` : ''}`, locals.accessToken),
    filters: {
      type: type ?? '',
      status: status ?? ''
    }
  };
};

export const actions = {
  create: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, '/devices', locals.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: stringOrNull(formData.get('name')),
        type: stringOrNull(formData.get('type')),
        status: stringOrNull(formData.get('status')) ?? 'disconnected',
        configuration: parseJsonObject(formData.get('configuration')),
        displayConfiguration: parseJsonObject(formData.get('displayConfiguration')),
        metadata: parseJsonObject(formData.get('metadata'))
      })
    });
  },
  update: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const deviceId = String(formData.get('deviceId'));
    await apiRequest(fetch, locals.apiBase, `/devices/${deviceId}`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        name: stringOrNull(formData.get('name')),
        type: stringOrNull(formData.get('type')),
        status: stringOrNull(formData.get('status')) ?? 'disconnected',
        configuration: parseJsonObject(formData.get('configuration')),
        displayConfiguration: parseJsonObject(formData.get('displayConfiguration')),
        metadata: parseJsonObject(formData.get('metadata'))
      })
    });
  },
  delete: async ({ fetch, locals, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await apiRequest(fetch, locals.apiBase, `/devices/${String(formData.get('deviceId'))}`, locals.accessToken, {
      method: 'DELETE'
    });
  }
};

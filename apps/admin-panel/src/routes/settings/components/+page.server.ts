import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin']);
  const components = await apiRequest(fetch, locals.apiBase, '/components/status', locals.accessToken) as Array<Record<string, unknown>>;
  return {
    components: components.map((component) => ({
      ...component,
      componentId: component.instanceId ?? component.component,
      componentName: component.component,
      checkedAt: component.updatedAt,
      message: component.available ? 'Available' : 'Not currently available'
    })) as Array<Record<string, any>>
  };
};

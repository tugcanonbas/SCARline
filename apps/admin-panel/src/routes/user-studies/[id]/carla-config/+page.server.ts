import { apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    config: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/carla-config`, locals.accessToken),
    maps: await apiRequest(fetch, locals.apiBase, '/carla/presets/maps', locals.accessToken),
    weather: await apiRequest(fetch, locals.apiBase, '/carla/presets/weather', locals.accessToken),
    vehicles: await apiRequest(fetch, locals.apiBase, '/carla/presets/vehicles', locals.accessToken),
    studyId: params.id
  };
};

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    await fetch(`${locals.apiBase}/studies/${params.id}/carla-config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${locals.accessToken}`
      },
      body: JSON.stringify({
        map: formData.get('map'),
        weatherPreset: formData.get('weatherPreset') || null,
        egoVehicleBlueprint: formData.get('vehicle'),
        simulationMode: 'synchronous',
        fixedDeltaSeconds: 0.05,
        trafficConfig: {
          npcVehicleCount: Number(formData.get('npcVehicleCount') || 0)
        },
        sensors: [
          {
            type: 'sensor.camera.rgb',
            id: 'front_rgb',
            attributes: { image_size_x: '1280', image_size_y: '720', fov: '90' },
            transform: { x: 1.5, y: 0, z: 2.4 }
          }
        ]
      })
    });
  }
};

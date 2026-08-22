import { apiAction, apiRequest } from '$lib/server/api';
import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
  return {
    study: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    config: await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/carla-config`, locals.accessToken),
    maps: await apiRequest(fetch, locals.apiBase, '/carla/presets/maps', locals.accessToken),
    weather: await apiRequest(fetch, locals.apiBase, '/carla/presets/weather', locals.accessToken),
    vehicles: await apiRequest(fetch, locals.apiBase, '/carla/presets/vehicles', locals.accessToken),
    studyId: params.id,
    canManage: user.roles?.some((role: string) => role === 'admin' || role === 'researcher') ?? false
  };
};

function numberFromForm(formData: FormData, key: string, fallback: number) {
  const value = String(formData.get(key) ?? '').trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sensorEnabled(formData: FormData, key: string) {
  return formData.get(key) === 'on';
}

export const actions = {
  default: async ({ fetch, locals, params, request }) => {
    await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher']);
    const formData = await request.formData();
    const sensors = [
      sensorEnabled(formData, 'sensorRgb') ? {
        type: 'sensor.camera.rgb',
        id: 'front_rgb',
        attributes: {
          image_size_x: String(numberFromForm(formData, 'cameraWidth', 1280)),
          image_size_y: String(numberFromForm(formData, 'cameraHeight', 720)),
          fov: String(numberFromForm(formData, 'cameraFov', 90))
        },
        transform: { x: 1.5, y: 0, z: 2.4 }
      } : null,
      sensorEnabled(formData, 'sensorLidar') ? {
        type: 'sensor.lidar.ray_cast',
        id: 'roof_lidar',
        attributes: {
          range: String(numberFromForm(formData, 'lidarRange', 80)),
          channels: String(numberFromForm(formData, 'lidarChannels', 32))
        },
        transform: { x: 0, y: 0, z: 2.6 }
      } : null,
      sensorEnabled(formData, 'sensorGnss') ? {
        type: 'sensor.other.gnss',
        id: 'gnss',
        attributes: {},
        transform: { x: 0, y: 0, z: 2.2 }
      } : null,
      sensorEnabled(formData, 'sensorImu') ? {
        type: 'sensor.other.imu',
        id: 'imu',
        attributes: {},
        transform: { x: 0, y: 0, z: 2.2 }
      } : null,
      sensorEnabled(formData, 'sensorCollision') ? {
        type: 'sensor.other.collision',
        id: 'collision',
        attributes: {},
        transform: { x: 0, y: 0, z: 1.0 }
      } : null,
      sensorEnabled(formData, 'sensorLane') ? {
        type: 'sensor.other.lane_invasion',
        id: 'lane_invasion',
        attributes: {},
        transform: { x: 0, y: 0, z: 1.0 }
      } : null
    ].filter(Boolean);

    const result = await apiAction(fetch, locals.apiBase, `/studies/${params.id}/carla-config`, locals.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        map: formData.get('map'),
        weatherPreset: formData.get('weatherPreset') || null,
        weatherCustom: {
          cloudiness: numberFromForm(formData, 'cloudiness', 0),
          precipitation: numberFromForm(formData, 'precipitation', 0),
          windIntensity: numberFromForm(formData, 'windIntensity', 0)
        },
        egoVehicleBlueprint: formData.get('vehicle'),
        simulationMode: formData.get('simulationMode') || 'synchronous',
        fixedDeltaSeconds: numberFromForm(formData, 'fixedDeltaSeconds', 0.05),
        trafficConfig: {
          npcVehicleCount: numberFromForm(formData, 'npcVehicleCount', 15),
          speedDifference: numberFromForm(formData, 'trafficSpeedDifference', 0)
        },
        pedestrianConfig: {
          pedestrianCount: numberFromForm(formData, 'pedestrianCount', 0)
        },
        sunConfig: {
          sunAltitudeAngle: numberFromForm(formData, 'sunAltitudeAngle', 45)
        },
        spectatorConfig: {
          enabled: sensorEnabled(formData, 'spectatorEnabled'),
          x: numberFromForm(formData, 'spectatorX', -6),
          y: numberFromForm(formData, 'spectatorY', 0),
          z: numberFromForm(formData, 'spectatorZ', 4),
          pitch: numberFromForm(formData, 'spectatorPitch', -15),
          yaw: numberFromForm(formData, 'spectatorYaw', 0),
          roll: 0
        },
        recordingConfig: {
          enabled: sensorEnabled(formData, 'recordingEnabled'),
          directory: String(formData.get('recordingDirectory') || '')
        },
        sensors
      })
    }, 'Failed to save CARLA configuration');
    return result.ok ? undefined : result.failure;
  }
};

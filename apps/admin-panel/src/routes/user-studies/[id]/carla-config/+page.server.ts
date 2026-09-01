import { apiRequest } from '$lib/server/api';
import { saveAndApplySimulatorTemplate } from '$lib/server/condition-configuration';
import { requireRole } from '$lib/server/rbac';
import { requirePrimaryCondition } from '$lib/server/study-context';
import { handleStudyTransition } from '$lib/server/study-lifecycle';
import { fail, isHttpError } from '@sveltejs/kit';

export const load = async ({ fetch, locals, params }) => {
  const user = await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'observer']);
  const condition = await requirePrimaryCondition(fetch, locals, params.id);
  const simulator = await apiRequest(fetch, locals.apiBase, `/studies/${params.id}/conditions/${condition.id}/simulator`, locals.accessToken) as Record<string, unknown> | null;
  const [study, readiness] = await Promise.all([
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}`, locals.accessToken),
    apiRequest(fetch, locals.apiBase, `/studies/${params.id}/readiness`, locals.accessToken)
  ]);
  const studyRecord = study as Record<string, unknown>;
  const metadata = studyRecord.metadata && typeof studyRecord.metadata === 'object'
    ? studyRecord.metadata as Record<string, unknown>
    : {};
  const templates = metadata.configurationTemplates && typeof metadata.configurationTemplates === 'object'
    ? metadata.configurationTemplates as Record<string, unknown>
    : {};
  const savedTemplate = templates.simulator && typeof templates.simulator === 'object'
    ? templates.simulator as Record<string, unknown>
    : {};
  const simulatorConfiguration = simulator?.configuration && typeof simulator.configuration === 'object'
    ? simulator.configuration as Record<string, unknown>
    : {};
  return {
    study,
    readiness,
    config: (simulator?.simulatorType === 'mock' ? savedTemplate : simulatorConfiguration) as Record<string, any>,
    maps: ['Town01', 'Town02', 'Town03', 'Town04', 'Town05', 'Town10HD'],
    weather: ['ClearNoon', 'CloudyNoon', 'WetNoon', 'HardRainNoon', 'ClearSunset'],
    vehicles: ['vehicle.tesla.model3', 'vehicle.audi.tt', 'vehicle.lincoln.mkz_2020'],
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
  studyTransition: handleStudyTransition,
  saveSimulator: async ({ fetch, locals, params, request }) => {
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

    try {
      await saveAndApplySimulatorTemplate(fetch, locals, params.id, {
        map: formData.get('map'),
        weatherPreset: formData.get('weatherPreset') || null,
        weatherCustom: {
          cloudiness: numberFromForm(formData, 'cloudiness', 0),
          precipitation: numberFromForm(formData, 'precipitation', 0),
          windIntensity: numberFromForm(formData, 'windIntensity', 0)
        },
        egoVehicleBlueprint: formData.get('vehicle'),
        simulationMode: 'synchronous',
        fixedDeltaSeconds: 0.05,
        controlMode: formData.get('controlMode') || 'io',
        randomSeed: numberFromForm(formData, 'randomSeed', 0),
        trafficConfig: {
          npcVehicleCount: numberFromForm(formData, 'npcVehicleCount', 15),
          speedDifference: numberFromForm(formData, 'trafficSpeedDifference', 0),
          speedLimitOverride: null
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
          directory: String(formData.get('recordingDirectory') || '').trim() || null
        },
        sensors
      });
      return { saved: true, message: 'Simulator configuration saved.' };
    } catch (cause) {
      if (isHttpError(cause)) {
        return fail(cause.status, {
          saved: false,
          message: cause.body.message || 'Simulator configuration could not be saved. Retry saving.'
        });
      }
      return fail(500, {
        saved: false,
        message: 'Simulator configuration could not be saved. Retry saving.'
      });
    }
  }
};

import { error } from '@sveltejs/kit';
import { apiRequest } from './api';

export async function loadStudyConditions(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string
) {
  return await apiRequest(fetch, locals.apiBase, `/studies/${studyId}/conditions`, locals.accessToken) as Array<Record<string, unknown>>;
}

export async function loadActiveStudyConditions(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string
) {
  const conditions = await loadStudyConditions(fetch, locals, studyId);
  return conditions.filter((entry) => !entry.archivedAt && typeof entry.id === 'string');
}

export async function requirePrimaryCondition(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string
) {
  const conditions = await loadActiveStudyConditions(fetch, locals, studyId);
  const condition = conditions[0];
  if (!condition || typeof condition.id !== 'string') {
    throw error(409, 'Create a study condition before configuring simulator, sensors, or participant layouts.');
  }
  return condition;
}

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

export async function getPrimaryCondition(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string
) {
  const conditions = await loadActiveStudyConditions(fetch, locals, studyId);
  return conditions[0] ?? null;
}

export async function requirePrimaryCondition(
  fetch: typeof globalThis.fetch,
  locals: App.Locals,
  studyId: string
) {
  return await getPrimaryCondition(fetch, locals, studyId);
}


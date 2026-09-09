import { apiAction } from "$lib/server/api";
import { requireRole } from "$lib/server/rbac";

export async function handleStudyTransition(input: {
  fetch: typeof globalThis.fetch;
  locals: App.Locals;
  params: Record<string, string | undefined>;
  request: Request;
}) {
  await requireRole(
    input.fetch,
    input.locals.apiBase,
    input.locals.accessToken,
    ["admin", "researcher"],
  );
  const studyId = String(input.params.id ?? "");
  const form = await input.request.formData();
  const to = String(form.get("to") ?? "");
  const result = await apiAction(
    input.fetch,
    input.locals.apiBase,
    `/studies/${studyId}/transition`,
    input.locals.accessToken,
    { method: "POST", body: JSON.stringify({ to }) },
    "Failed to update study status",
  );
  return result.ok ? { studyTransitioned: true } : result.failure;
}

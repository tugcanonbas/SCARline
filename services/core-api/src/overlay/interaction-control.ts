import type { OverlayRuntimeScope } from "@scarline/contracts";
import type { Pool } from "pg";

import { ApiProblem } from "../errors.js";
import { createEnvelope, enqueueMessage } from "../infrastructure/outbox.js";
import { loadOverlayRuntimeSnapshot } from "./runtime.js";
import { lockCurrentSessionCondition, lockSession, resolveActiveWidgetTarget } from "./runtime-control.js";
import { hasInteractionReceipt, previewRuntime, readInteractionReceipts, runtimeRevision } from "./preview-runtime.js";
import { interactionBindings, projectMusicBindings, requireWidgetAction, type WidgetInteraction } from "./widget-interactions.js";
import { configuredWidgetRuntime, filterStoredBindingValues, readStoredWidgetRuntimeOverrides } from "./widget-runtime-state.js";

export async function applyOverlayWidgetInteraction(pool: Pool, scope: OverlayRuntimeScope, input: WidgetInteraction) {
  if (scope.instanceId !== null && scope.instanceId !== input.instanceId) {
    throw new ApiProblem(403, "WIDGET_OUT_OF_SCOPE", "Widget instance is outside this overlay scope.");
  }
  // Check the actual layout even for session-scoped renderers. A condition switch
  // must never redirect a late participant click to an equivalent new widget.
  const snapshot = await loadOverlayRuntimeSnapshot(pool, scope);
  const widget = snapshot.widgets.find((entry) => entry.instanceId === input.instanceId);
  if (!widget) throw new ApiProblem(403, "WIDGET_OUT_OF_SCOPE", "Widget instance is outside this overlay scope.");

  if (scope.sessionId === null) {
    if (!scope.previewId) throw new ApiProblem(409, "PREVIEW_RELAUNCH_REQUIRED", "Relaunch this widget from Participant View to test its controls.");
    const metadata = requireWidgetAction(widget.metadata, input.action, widget.state);
    // No awaits between reading and updating this launch's temporary state.
    const preview = previewRuntime(pool, scope.previewId);
    const duplicate = hasInteractionReceipt(preview.receipts, input);
    if (!duplicate && preview.receipts.length >= 4_096) {
      throw new ApiProblem(409, "PREVIEW_RELAUNCH_REQUIRED", "Relaunch this widget to start a fresh interaction preview.");
    }
    const current = { ...widget.bindings, ...preview.bindings[input.instanceId] };
    const values = interactionBindings(widget.widgetKey, metadata, current, input.action);
    if (!duplicate) {
      if (values !== null) preview.bindings[input.instanceId] = { ...preview.bindings[input.instanceId], ...values };
      preview.revision += 1;
      preview.receipts.push({ requestId: input.requestId, instanceId: input.instanceId, action: input.action });
    }
    return result(scope, input, widget.widgetId, widget.widgetKey, widget.state, {
      ...(duplicate || input.observedRevision === undefined ? current : {}), ...preview.bindings[input.instanceId],
    }, preview.revision, values !== null, duplicate, duplicate || input.observedRevision === undefined);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSession(client, scope.sessionId);
    const condition = await lockCurrentSessionCondition(client, scope.sessionId);
    if (session.study_id !== scope.studyId || condition.condition_id !== scope.conditionId) {
      throw new ApiProblem(409, "INTERACTION_CONDITION_CHANGED", "The active study condition has changed. Reopen the current widget.");
    }
    const target = await resolveActiveWidgetTarget(client, scope.studyId, scope.conditionId, input.instanceId);
    if (target.instance_id !== input.instanceId) throw new ApiProblem(403, "WIDGET_OUT_OF_SCOPE", "Widget instance is outside this overlay scope.");
    const configured = configuredWidgetRuntime(target.metadata, target.condition_metadata, input.instanceId, target.widget_key);
    const runtime = condition.runtime_metadata ?? {};
    const overrides = readStoredWidgetRuntimeOverrides(runtime);
    const previous = overrides[input.instanceId];
    const state = previous?.state ?? configured.state;
    const metadata = requireWidgetAction(configured.metadata, input.action, state);
    const current = { ...configured.bindings, ...filterStoredBindingValues(metadata, previous?.bindingValues ?? {}) };
    const receipts = readInteractionReceipts(runtime.widgetInteractionReceipts);
    const duplicate = hasInteractionReceipt(receipts, input);
    const values = interactionBindings(target.widget_key, metadata, current, input.action);
    const revision = runtimeRevision(runtime.widgetRuntimeRevision) + (duplicate ? 0 : 1);
    const resetRevisions = runtime.widgetResetRevisions as Record<string, unknown> | undefined;
    const replaceBindings = duplicate || input.observedRevision === undefined
      || runtimeRevision(resetRevisions?.[input.instanceId]) > input.observedRevision;
    const response = result(scope, input, target.widget_id, target.widget_key, state,
      { ...(replaceBindings ? current : previous?.bindingValues), ...(!duplicate ? values : {}) },
      revision, values !== null, duplicate, replaceBindings);
    if (!duplicate) {
      if (values !== null) overrides[input.instanceId] = {
        ...previous, widgetKey: target.widget_key, layoutType: target.layout_type,
        layoutName: target.layout_name, order: target.order,
        bindingValues: { ...previous?.bindingValues, ...values }, updatedAt: new Date().toISOString(),
      };
      await client.query("UPDATE session_conditions SET runtime_metadata=$2::jsonb WHERE id=$1", [condition.id, JSON.stringify({
        ...runtime, widgetRuntime: overrides, widgetRuntimeRevision: revision,
        widgetInteractionReceipts: [...receipts, { requestId: input.requestId, instanceId: input.instanceId, action: input.action }],
      })]);
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${scope.studyId}.${scope.sessionId}.widget.interaction`,
        studyId: scope.studyId, sessionId: scope.sessionId, correlationId: input.requestId,
        payload: { ...input, widgetId: target.widget_id, widgetKey: target.widget_key,
          source: "overlay-widget", sessionConditionId: condition.id, applied: values !== null,
          bindingValues: values ?? {}, revision },
      }));
    }
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function result(scope: OverlayRuntimeScope, input: WidgetInteraction, widgetId: string, widgetKey: string, state: string,
  bindingValues: Record<string, unknown>, revision: number, applied: boolean, duplicate: boolean, replaceBindings: boolean) {
  if (widgetKey === "music" && (replaceBindings || Object.hasOwn(bindingValues, "media.is_playing"))) {
    bindingValues = projectMusicBindings(bindingValues);
  }
  return { accepted: true, applied, duplicate, requestId: input.requestId, update: {
    instanceId: input.instanceId, widgetId, widgetKey, action: input.action, payload: input.payload,
    requestId: input.requestId, state, bindingValues, replaceBindings, revision, source: "overlay-widget",
    conditionId: scope.conditionId, ...(scope.previewId ? { previewId: scope.previewId } : {}),
  } };
}

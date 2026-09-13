import type { Pool } from "pg";

import { ApiProblem } from "../errors.js";

export interface InteractionReceipt {
  requestId: string;
  instanceId: string;
  action: string;
}

interface PreviewRuntime {
  bindings: Record<string, Record<string, unknown>>;
  receipts: InteractionReceipt[];
  revision: number;
  touchedAt: number;
}

// Preview state is temporary and never written to a study or participant session.
// Keep it across renderer reconnects; relaunching creates a fresh previewId.
const stores = new WeakMap<Pool, Map<string, PreviewRuntime>>();
const idleLifetime = 24 * 60 * 60 * 1_000;

export function previewRuntime(pool: Pool, previewId: string): PreviewRuntime {
  let store = stores.get(pool);
  if (store === undefined) {
    store = new Map();
    stores.set(pool, store);
  }
  const now = Date.now();
  for (const [id, value] of store) {
    if (now - value.touchedAt > idleLifetime) store.delete(id);
  }
  let value = store.get(previewId);
  if (value === undefined) {
    if (store.size >= 128) {
      throw new ApiProblem(503, "PREVIEW_CAPACITY_REACHED", "Too many widget previews are open. Try again later.");
    }
    value = { bindings: {}, receipts: [], revision: 0, touchedAt: now };
    store.set(previewId, value);
  }
  value.touchedAt = now;
  return value;
}

export function hasInteractionReceipt(receipts: InteractionReceipt[], input: InteractionReceipt): boolean {
  const previous = receipts.find((entry) => entry.requestId === input.requestId);
  if (previous && (previous.instanceId !== input.instanceId || previous.action !== input.action)) {
    throw new ApiProblem(409, "INTERACTION_REQUEST_CONFLICT", "This interaction request was already used for a different action.");
  }
  return previous !== undefined;
}

export function readInteractionReceipts(value: unknown): InteractionReceipt[] {
  return Array.isArray(value) ? value.filter((entry): entry is InteractionReceipt =>
    entry !== null && typeof entry === "object"
    && typeof entry.requestId === "string" && typeof entry.instanceId === "string" && typeof entry.action === "string") : [];
}

export function runtimeRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

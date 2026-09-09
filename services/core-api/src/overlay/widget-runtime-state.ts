import {
  WidgetMetadataSchema,
  type WidgetMetadata,
} from "@scarline/contracts";

import { ApiProblem } from "../errors.js";

export type WidgetVisualState = "visible" | "hidden" | "highlighted";

export interface StoredWidgetRuntimeOverride {
  readonly state?: WidgetVisualState;
  readonly bindingValues: Record<string, unknown>;
  readonly widgetKey: string;
  readonly layoutType: string;
  readonly layoutName: string;
  readonly order: number;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
}

export function configuredWidgetRuntime(
  metadataInput: unknown,
  conditionMetadataInput: unknown,
  instanceId: string,
  widgetKey: string,
): { metadata: WidgetMetadata; bindings: Record<string, unknown>; state: WidgetVisualState } {
  const metadata = WidgetMetadataSchema.parse(metadataInput);
  const widgetOverrides = readObject(readObject(conditionMetadataInput).widgetOverrides);
  const hidden = new Set(readStringArray(widgetOverrides.hidden_widgets));
  const highlighted = new Set(readStringArray(widgetOverrides.highlighted_widgets));
  const bindingOverrides = readObject(widgetOverrides.binding_values);
  const instanceBindings = readObject(
    bindingOverrides[instanceId] ?? bindingOverrides[widgetKey],
  );
  const bindings = Object.fromEntries(metadata.bindings.flatMap((binding) => {
    if (Object.hasOwn(instanceBindings, binding.key)) {
      return [[binding.key, instanceBindings[binding.key]]];
    }
    return binding.default === undefined ? [] : [[binding.key, binding.default]];
  }));
  const state = hidden.has(instanceId) || hidden.has(widgetKey)
    ? "hidden"
    : highlighted.has(instanceId) || highlighted.has(widgetKey)
      ? "highlighted"
      : "visible";
  return { metadata, bindings, state };
}

export function validateManualBindingValues(
  metadata: WidgetMetadata,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const declarations = new Map(metadata.bindings.map((binding) => [binding.key, binding.type]));
  const validated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const type = declarations.get(key);
    if (type === undefined) {
      throw new ApiProblem(400, "UNDECLARED_WIDGET_BINDING", `Widget binding '${key}' is not declared in metadata.`);
    }
    if (!matchesBindingType(value, type)) {
      throw new ApiProblem(400, "INVALID_WIDGET_BINDING_VALUE", `Widget binding '${key}' must have type ${type}.`);
    }
    validated[key] = value;
  }
  return validated;
}

export function filterStoredBindingValues(
  metadata: WidgetMetadata,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const declarations = new Map(metadata.bindings.map((binding) => [binding.key, binding.type]));
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
    const type = declarations.get(key);
    return type !== undefined && matchesBindingType(value, type);
  }));
}

export function readStoredWidgetRuntimeOverrides(
  runtimeMetadataInput: unknown,
): Record<string, StoredWidgetRuntimeOverride> {
  const raw = readObject(readObject(runtimeMetadataInput).widgetRuntime);
  const result: Record<string, StoredWidgetRuntimeOverride> = {};
  for (const [instanceId, value] of Object.entries(raw)) {
    const entry = readObject(value);
    const state = readVisualState(entry.state);
    const widgetKey = typeof entry.widgetKey === "string" ? entry.widgetKey : null;
    const layoutType = typeof entry.layoutType === "string" ? entry.layoutType : null;
    const layoutName = typeof entry.layoutName === "string" ? entry.layoutName : null;
    const order = typeof entry.order === "number" && Number.isInteger(entry.order) ? entry.order : null;
    if (widgetKey === null || layoutType === null || layoutName === null || order === null) continue;
    result[instanceId] = {
      ...(state === null ? {} : { state }),
      bindingValues: readObject(entry.bindingValues),
      widgetKey,
      layoutType,
      layoutName,
      order,
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}),
      ...(typeof entry.updatedBy === "string" ? { updatedBy: entry.updatedBy } : {}),
    };
  }
  return result;
}

export function findStoredWidgetRuntimeOverride(
  overrides: Record<string, StoredWidgetRuntimeOverride>,
  input: { instanceId: string; widgetKey: string; layoutType: string; layoutName: string; order: number },
): StoredWidgetRuntimeOverride | undefined {
  return overrides[input.instanceId]
    ?? Object.values(overrides).find((entry) =>
      entry.widgetKey === input.widgetKey
      && entry.layoutType === input.layoutType
      && entry.layoutName === input.layoutName
      && entry.order === input.order);
}

function matchesBindingType(value: unknown, type: WidgetMetadata["bindings"][number]["type"]): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function readVisualState(value: unknown): WidgetVisualState | null {
  return value === "visible" || value === "hidden" || value === "highlighted" ? value : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

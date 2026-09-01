import { z } from "zod";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  UuidSchema,
} from "./common.js";

export const LayoutTypeSchema = z.enum([
  "participant",
  "researcher_monitor",
]);

export const WidgetWindowModeSchema = z.enum([
  "transparent_electron",
  "browser_popup",
]);

export const OverlayRendererModeSchema = z.enum(["desktop", "browser"]);

export const OverlayHostIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const OverlayInputModeSchema = z.enum([
  "click_through",
  "interactive",
]);

export const WidgetInstanceSchema = z
  .object({
    id: UuidSchema,
    layoutId: UuidSchema,
    widgetId: UuidSchema,
    windowMode: WidgetWindowModeSchema,
    inputMode: OverlayInputModeSchema,
    targetDisplay: z.string().min(1),
    order: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    enabled: z.boolean(),
    configuration: JsonObjectSchema,
    bindingsConfig: JsonObjectSchema,
    styleOverrides: JsonObjectSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const LayoutSchema = z
  .object({
    id: UuidSchema,
    conditionId: UuidSchema,
    name: z.string().min(1).max(200),
    type: LayoutTypeSchema,
    targetDisplay: z.string().min(1).nullable(),
    layoutConfig: JsonObjectSchema,
    revision: z.number().int().positive(),
    widgets: z.array(WidgetInstanceSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const LayoutExpectedRevisionSchema = z
  .object({
    conditionId: UuidSchema,
    layoutId: UuidSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const ParticipantLayoutBulkWidgetSchema = z
  .object({
    widgetId: UuidSchema,
    windowMode: WidgetWindowModeSchema,
    inputMode: OverlayInputModeSchema,
    targetDisplay: z.string().min(1).max(100),
    order: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    enabled: z.boolean(),
    configuration: JsonObjectSchema,
    bindingsConfig: JsonObjectSchema,
    styleOverrides: JsonObjectSchema,
  })
  .strict();

export const ParticipantLayoutBulkSaveSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    targetDisplay: z.string().min(1).max(100).nullable(),
    layoutConfig: JsonObjectSchema,
    expectedRevisions: z.array(LayoutExpectedRevisionSchema).min(1),
    widgets: z.array(ParticipantLayoutBulkWidgetSchema),
  })
  .strict();

export const ParticipantLayoutBulkSaveResultSchema = z
  .object({
    primaryLayoutId: UuidSchema,
    layouts: z.array(z.object({
      conditionId: UuidSchema,
      layoutId: UuidSchema,
      revision: z.number().int().positive(),
    }).strict()).min(1),
  })
  .strict();

export const SessionParticipantWindowSaveSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    windowMode: WidgetWindowModeSchema,
    inputMode: OverlayInputModeSchema,
    targetDisplay: z.string().min(1).max(100),
    order: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    enabled: z.boolean(),
    configuration: JsonObjectSchema,
    bindingsConfig: JsonObjectSchema,
    styleOverrides: JsonObjectSchema,
  })
  .strict();

export const SessionParticipantWindowSaveResultSchema = z
  .object({
    sessionId: UuidSchema,
    conditionId: UuidSchema,
    layoutId: UuidSchema,
    revision: z.number().int().positive(),
    instanceId: UuidSchema,
  })
  .strict();

export const DisplayBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const OverlayDisplaySchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    primary: z.boolean(),
    scaleFactor: z.number().positive(),
    bounds: DisplayBoundsSchema,
    workArea: DisplayBoundsSchema,
  })
  .strict();

export const OverlayWindowSpecSchema = z
  .object({
    instanceId: UuidSchema,
    targetDisplay: z.string().min(1),
    windowMode: WidgetWindowModeSchema,
    inputMode: OverlayInputModeSchema.default("click_through"),
    coordinateSpace: z.literal("display-relative"),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const OverlayRuntimeScopeSchema = z
  .object({
    rendererMode: OverlayRendererModeSchema,
    studyId: UuidSchema,
    sessionId: UuidSchema.nullable(),
    conditionId: UuidSchema,
    layoutId: UuidSchema,
    instanceId: UuidSchema.nullable(),
  })
  .strict();

export const OverlayRuntimeWidgetSchema = z
  .object({
    instanceId: UuidSchema,
    widgetId: UuidSchema,
    widgetKey: z.string().min(1),
    name: z.string().min(1),
    entry: z.string().min(1),
    windowMode: WidgetWindowModeSchema,
    inputMode: OverlayInputModeSchema,
    targetDisplay: z.string().min(1),
    order: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    metadata: JsonObjectSchema,
    configuration: JsonObjectSchema,
    bindingsConfig: JsonObjectSchema,
    styleOverrides: JsonObjectSchema,
    bindings: JsonObjectSchema,
    state: z.enum(["visible", "hidden", "highlighted"]),
  })
  .strict();

export const OverlayRuntimeSnapshotSchema = z
  .object({
    scope: OverlayRuntimeScopeSchema,
    layout: z
      .object({
        id: UuidSchema,
        name: z.string().min(1),
        targetDisplay: z.string().min(1).nullable(),
      })
      .strict(),
    displays: z.array(OverlayDisplaySchema),
    widgets: z.array(OverlayRuntimeWidgetSchema),
  })
  .strict();

export const WidgetRuntimeActionSchema = z.enum([
  "trigger",
  "show",
  "hide",
  "highlight",
  "reset",
  "update",
]);

export const WidgetRuntimeCommandSchema = z
  .object({
    instanceId: UuidSchema,
    action: WidgetRuntimeActionSchema,
    bindingValues: JsonObjectSchema.default({}),
  })
  .strict();

export const OverlayControlMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("overlay.window.open"),
      hostId: OverlayHostIdSchema.optional(),
      window: OverlayWindowSpecSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.window.update"),
      hostId: OverlayHostIdSchema.optional(),
      window: OverlayWindowSpecSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.window.close"),
      hostId: OverlayHostIdSchema.optional(),
      instanceId: UuidSchema,
    })
    .strict(),
  z.object({ type: z.literal("overlay.reload"), hostId: OverlayHostIdSchema.optional() }).strict(),
]);

const OverlayHostCommandBaseSchema = z.object({
  commandId: UuidSchema,
  hostId: OverlayHostIdSchema,
  issuedAt: IsoDateTimeSchema,
});

const OverlayHostEventBaseSchema = z.object({
  hostId: OverlayHostIdSchema,
  occurredAt: IsoDateTimeSchema,
});

export const OverlayHostCommandSchema = z.discriminatedUnion("type", [
  OverlayHostCommandBaseSchema.extend({
    type: z.literal("overlay.window.open"),
    window: OverlayWindowSpecSchema.extend({
      widgetKey: z.string().min(1),
      rendererUrl: z.string().url(),
    }).strict(),
  }).strict(),
  OverlayHostCommandBaseSchema.extend({
    type: z.literal("overlay.window.update"),
    window: OverlayWindowSpecSchema,
  }).strict(),
  OverlayHostCommandBaseSchema.extend({
    type: z.literal("overlay.window.close"),
    instanceId: UuidSchema,
  }).strict(),
  OverlayHostCommandBaseSchema.extend({
    type: z.literal("overlay.reload"),
  }).strict(),
]);

export const OverlayHostEventSchema = z.discriminatedUnion("type", [
  OverlayHostEventBaseSchema
    .extend({
      type: z.literal("overlay.status"),
      ready: z.boolean(),
      displays: z.array(OverlayDisplaySchema),
      windows: z.array(
        z
          .object({
            instanceId: UuidSchema,
            targetDisplay: z.string().min(1),
            liveDisplay: z.string().min(1),
            degraded: z.boolean(),
            degradedReason: z.string().min(1).nullable(),
            bounds: DisplayBoundsSchema,
          })
          .strict(),
      ),
    })
    .strict(),
  OverlayHostEventBaseSchema
    .extend({
      type: z.literal("overlay.window.changed"),
      instanceId: UuidSchema,
      targetDisplay: z.string().min(1),
      bounds: DisplayBoundsSchema,
    })
    .strict(),
  OverlayHostEventBaseSchema
    .extend({
      type: z.literal("overlay.command.result"),
      commandId: UuidSchema,
      accepted: z.boolean(),
      error: z.string().min(1).nullable(),
    })
    .strict(),
]);

export const OverlayWindowStatusPayloadSchema = z
  .object({
    type: z.literal("overlay.window.status"),
    hostId: OverlayHostIdSchema,
    occurredAt: IsoDateTimeSchema,
    instanceId: UuidSchema,
    targetDisplay: z.string().min(1),
    liveDisplay: z.string().min(1),
    degraded: z.boolean(),
    degradedReason: z.string().min(1).nullable(),
    bounds: DisplayBoundsSchema,
  })
  .strict();

export const OverlayRuntimeServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("overlay.runtime.ready"),
      scope: OverlayRuntimeScopeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.runtime.bindings"),
      instanceId: UuidSchema,
      bindings: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.runtime.trigger"),
      instanceId: UuidSchema,
      trigger: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.runtime.state"),
      instanceId: UuidSchema,
      state: z.enum(["visible", "hidden", "highlighted"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.runtime.session"),
      status: z.enum([
        "created",
        "ready",
        "running",
        "paused",
        "completed",
        "aborted",
        "failed",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("overlay.runtime.close"),
      reason: z.enum(["session-terminal", "condition-changed"]),
    })
    .strict(),
]);

export type Layout = z.infer<typeof LayoutSchema>;
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;
export type ParticipantLayoutBulkSave = z.infer<typeof ParticipantLayoutBulkSaveSchema>;
export type ParticipantLayoutBulkSaveResult = z.infer<typeof ParticipantLayoutBulkSaveResultSchema>;
export type SessionParticipantWindowSave = z.infer<typeof SessionParticipantWindowSaveSchema>;
export type SessionParticipantWindowSaveResult = z.infer<typeof SessionParticipantWindowSaveResultSchema>;
export type OverlayDisplay = z.infer<typeof OverlayDisplaySchema>;
export type OverlayHostId = z.infer<typeof OverlayHostIdSchema>;
export type OverlayRendererMode = z.infer<typeof OverlayRendererModeSchema>;
export type OverlayInputMode = z.infer<typeof OverlayInputModeSchema>;
export type OverlayWindowSpec = z.infer<typeof OverlayWindowSpecSchema>;
export type OverlayControlMessage = z.infer<
  typeof OverlayControlMessageSchema
>;
export type OverlayHostCommand = z.infer<typeof OverlayHostCommandSchema>;
export type OverlayHostEvent = z.infer<typeof OverlayHostEventSchema>;
export type OverlayWindowStatusPayload = z.infer<typeof OverlayWindowStatusPayloadSchema>;
export type OverlayRuntimeScope = z.infer<typeof OverlayRuntimeScopeSchema>;
export type OverlayRuntimeSnapshot = z.infer<typeof OverlayRuntimeSnapshotSchema>;
export type OverlayRuntimeServerMessage = z.infer<typeof OverlayRuntimeServerMessageSchema>;
export type WidgetRuntimeAction = z.infer<typeof WidgetRuntimeActionSchema>;
export type WidgetRuntimeCommand = z.infer<typeof WidgetRuntimeCommandSchema>;

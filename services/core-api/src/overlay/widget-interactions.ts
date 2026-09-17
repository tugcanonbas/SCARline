import { WidgetMetadataSchema, type WidgetMetadata } from "@scarline/contracts";

import { ApiProblem } from "../errors.js";
import { validateManualBindingValues } from "./widget-runtime-state.js";

export interface WidgetInteraction {
  requestId: string;
  instanceId: string;
  action: string;
  payload: Record<string, unknown>;
  observedRevision?: number | undefined;
}

export function interactionBindings(
  widgetKey: string,
  metadata: WidgetMetadata,
  current: Record<string, unknown>,
  action: string,
): Record<string, unknown> | null {
  let values: Record<string, unknown>;
  if (widgetKey === "activecall" && action === "call.mute") {
    values = { "call.is_muted": current["call.is_muted"] !== true };
  } else if (widgetKey === "activecall" && action === "call.hold") {
    values = { "call.is_on_hold": current["call.is_on_hold"] !== true };
  } else if (widgetKey === "activecall" && (action === "call.bluetooth" || action === "call.speaker")) {
    const bluetooth = action === "call.bluetooth";
    values = { "call.is_bluetooth": bluetooth, "call.is_speaker": !bluetooth,
      "call.audio_route_label": bluetooth ? "Bluetooth" : "Speaker" };
  } else if (widgetKey === "music" && action === "media.play_pause") {
    const now = Date.now();
    const playback = musicPosition(current, now);
    const playing = current["media.is_playing"] !== true || playback.position >= playback.duration;
    values = musicBindingUpdate(current, { "media.is_playing": playing,
      "media.position_seconds": playback.position >= playback.duration ? 0 : playback.position }, now);
  } else {
    return null;
  }
  return validateManualBindingValues(metadata, values);
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function labelSeconds(value: unknown, fallback: number): number {
  if (typeof value !== "string" || !/^\d+:\d{2}$/.test(value)) return fallback;
  const [minutes, seconds] = value.split(":").map(Number);
  return minutes! * 60 + seconds!;
}

function timeLabel(value: number): string {
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function musicPosition(bindings: Record<string, unknown>, now: number) {
  const duration = seconds(bindings["media.duration_seconds"], labelSeconds(bindings["media.duration_label"], 209));
  const base = seconds(bindings["media.position_seconds"], labelSeconds(bindings["media.progress_label"], 94));
  const startedAt = seconds(bindings["media.playback_started_at"], 0);
  const elapsed = bindings["media.is_playing"] === true && startedAt > 0 ? Math.max(0, now - startedAt) / 1_000 : 0;
  return { duration, position: Math.min(duration, base + elapsed) };
}

export function projectMusicBindings(bindings: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const { duration, position } = musicPosition(bindings, now);
  return { ...bindings, "media.progress_label": timeLabel(position), "media.duration_label": timeLabel(duration),
    "media.progress_ratio": duration > 0 ? position / duration * 100 : 0,
    "media.is_playing": bindings["media.is_playing"] === true && position < duration };
}

// Rebase the clock when a participant or researcher changes playback. Display
// ticks are derived from this anchor and do not create database writes/events.
export function musicBindingUpdate(current: Record<string, unknown>, patch: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const previous = musicPosition(current, now);
  const duration = seconds(patch["media.duration_seconds"], labelSeconds(patch["media.duration_label"], previous.duration));
  const position = Math.min(duration, seconds(patch["media.position_seconds"],
    labelSeconds(patch["media.progress_label"], typeof patch["media.progress_ratio"] === "number"
      ? Math.max(0, patch["media.progress_ratio"]) / 100 * duration : previous.position)));
  const playing = (patch["media.is_playing"] ?? current["media.is_playing"]) === true && position < duration;
  return projectMusicBindings({ ...patch, "media.position_seconds": position, "media.duration_seconds": duration,
    "media.is_playing": playing, "media.playback_started_at": playing ? now : 0 }, now);
}

export function requireWidgetAction(metadataInput: unknown, action: string, state: string): WidgetMetadata {
  const metadata = WidgetMetadataSchema.parse(metadataInput);
  if (!metadata.triggers.some((entry) => entry.action === action)) {
    throw new ApiProblem(400, "UNDECLARED_WIDGET_ACTION", "Widget action is not declared in metadata.");
  }
  if (state === "hidden") {
    throw new ApiProblem(409, "WIDGET_HIDDEN", "This widget is hidden. Ask the researcher to show it before using its controls.");
  }
  return metadata;
}

import type { OverlayDisplay, OverlayWindowSpec } from "./types.js";

export interface ElectronDisplayLike {
  id: number;
  label?: string;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
}

export function orderedDisplays(
  displays: readonly ElectronDisplayLike[],
  primaryId: number,
): OverlayDisplay[] {
  return [...displays]
    .sort((left, right) => left.id === primaryId ? -1 : right.id === primaryId ? 1 : left.id - right.id)
    .map((display, index) => ({
      id: String(display.id),
      index,
      name: display.label?.trim() || `Display ${index + 1}`,
      primary: display.id === primaryId,
      scaleFactor: display.scaleFactor,
      bounds: { ...display.bounds },
      workArea: { ...display.workArea },
    }));
}

export function absoluteBounds(
  display: ElectronDisplayLike,
  window: OverlayWindowSpec,
): { x: number; y: number; width: number; height: number } {
  return {
    x: display.bounds.x + window.x,
    y: display.bounds.y + window.y,
    width: window.width,
    height: window.height,
  };
}

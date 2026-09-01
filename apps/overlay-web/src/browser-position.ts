export interface BrowserDisplay {
  id: string;
  index: number;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BrowserWidgetBounds {
  targetDisplay: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function popupFeatures(
  widget: BrowserWidgetBounds,
  displays: BrowserDisplay[],
): string {
  const display = displays.find((entry) => entry.id === widget.targetDisplay)
    ?? displays.find((entry) => String(entry.index) === widget.targetDisplay)
    ?? (widget.targetDisplay === "primary" ? displays.find((entry) => entry.primary) : undefined)
    ?? displays.find((entry) => entry.primary)
    ?? displays[0];
  const left = (display?.bounds.x ?? 0) + widget.x;
  const top = (display?.bounds.y ?? 0) + widget.y;
  return [
    "popup=yes",
    `width=${widget.width}`,
    `height=${widget.height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=no",
  ].join(",");
}

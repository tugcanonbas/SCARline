import type { OverlayHostCommand, OverlayWindowSpec } from "./types.js";
import { absoluteBounds } from "./geometry.js";
import type { ElectronDisplayLike } from "./geometry.js";

export interface RectangleLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManagedBrowserWindowLike {
  destroy(): void;
  getBounds(): RectangleLike;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
  reload(): void;
  setBounds(bounds: RectangleLike): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  on(event: "move" | "resize" | "closed", listener: () => void): void;
}

export interface WindowManagerStatusEntry {
  instanceId: string;
  targetDisplay: string;
  liveDisplay: string;
  degraded: boolean;
  degradedReason: string | null;
  bounds: RectangleLike;
}

export interface WindowChangedEvent {
  type: "overlay.window.changed";
  instanceId: string;
  targetDisplay: string;
  bounds: RectangleLike;
}

interface ManagedWindow {
  browserWindow: ManagedBrowserWindowLike;
  targetDisplay: string;
  relativeBounds: RectangleLike;
  degradedReason: string | null;
  suppressedBounds: RectangleLike | null;
}

export interface OverlayWindowManagerOptions {
  createWindow(
    command: Extract<OverlayHostCommand, { type: "overlay.window.open" }>,
    bounds: RectangleLike,
  ): ManagedBrowserWindowLike;
  getAllDisplays(): readonly ElectronDisplayLike[];
  getPrimaryDisplay(): ElectronDisplayLike;
  getDisplayMatching(bounds: RectangleLike): ElectronDisplayLike;
  onWindowChanged(event: WindowChangedEvent): void;
  onStatusChanged(): void;
}

export class OverlayWindowManager {
  readonly #options: OverlayWindowManagerOptions;
  readonly #windows = new Map<string, ManagedWindow>();

  constructor(options: OverlayWindowManagerOptions) {
    this.#options = options;
  }

  async openWindow(
    command: Extract<OverlayHostCommand, { type: "overlay.window.open" }>,
  ): Promise<void> {
    const spec = command.window;
    this.closeWindow(spec.instanceId);
    const display = this.#selectDisplay(spec.targetDisplay);
    const relativeBounds = boundsFromSpec(spec);
    const browserWindow = this.#options.createWindow(
      command,
      absoluteBounds(display, spec),
    );
    const managed: ManagedWindow = {
      browserWindow,
      targetDisplay: String(display.id),
      relativeBounds,
      degradedReason: null,
      suppressedBounds: null,
    };
    this.#windows.set(spec.instanceId, managed);
    browserWindow.on("move", () => this.#emitGeometry(spec.instanceId));
    browserWindow.on("resize", () => this.#emitGeometry(spec.instanceId));
    browserWindow.on("closed", () => {
      if (this.#windows.get(spec.instanceId)?.browserWindow === browserWindow) {
        this.#windows.delete(spec.instanceId);
      }
      this.#options.onStatusChanged();
    });
    try {
      await browserWindow.loadURL(spec.rendererUrl);
    } catch (error) {
      if (this.#windows.get(spec.instanceId)?.browserWindow === browserWindow) {
        this.#windows.delete(spec.instanceId);
      }
      if (!browserWindow.isDestroyed()) browserWindow.destroy();
      this.#options.onStatusChanged();
      throw error;
    }
    this.#options.onStatusChanged();
  }

  updateWindow(spec: OverlayWindowSpec): void {
    const managed = this.#windows.get(spec.instanceId);
    if (managed === undefined) throw new Error("Widget window is not open.");
    const display = this.#selectDisplay(spec.targetDisplay);
    managed.targetDisplay = String(display.id);
    managed.relativeBounds = boundsFromSpec(spec);
    managed.degradedReason = null;
    this.#setBounds(managed, absoluteBounds(display, spec));
    managed.browserWindow.setIgnoreMouseEvents(
      spec.inputMode === "click_through",
      { forward: true },
    );
    this.#options.onStatusChanged();
  }

  closeWindow(instanceId: string): void {
    const managed = this.#windows.get(instanceId);
    if (managed === undefined) return;
    this.#windows.delete(instanceId);
    if (!managed.browserWindow.isDestroyed()) managed.browserWindow.destroy();
    this.#options.onStatusChanged();
  }

  reloadAll(): void {
    for (const managed of this.#windows.values()) {
      if (!managed.browserWindow.isDestroyed()) managed.browserWindow.reload();
    }
  }

  handleDisplayChange(
    reason: "added" | "removed" | "metrics-changed",
    changedDisplayId?: string,
  ): void {
    const displays = this.#options.getAllDisplays();
    const primary = this.#options.getPrimaryDisplay();
    for (const managed of this.#windows.values()) {
      if (managed.browserWindow.isDestroyed()) continue;
      const assigned = displays.find(({ id }) => String(id) === managed.targetDisplay);
      if (assigned === undefined) {
        managed.degradedReason = `Assigned display ${managed.targetDisplay} is unavailable.`;
        this.#setBounds(
          managed,
          fitWithinWorkArea(primary, managed.browserWindow.getBounds()),
        );
        continue;
      }
      if (reason === "metrics-changed" && String(assigned.id) === changedDisplayId) {
        managed.degradedReason = `Display ${managed.targetDisplay} metrics changed; verify the live placement.`;
        this.#setBounds(
          managed,
          fitWithinWorkArea(assigned, absoluteRectangle(assigned, managed.relativeBounds)),
        );
        continue;
      }
      if (reason === "added" && managed.degradedReason !== null) {
        managed.degradedReason = null;
        this.#setBounds(managed, absoluteRectangle(assigned, managed.relativeBounds));
      }
    }
    this.#options.onStatusChanged();
  }

  status(): WindowManagerStatusEntry[] {
    return [...this.#windows.entries()].flatMap(([instanceId, managed]) => {
      if (managed.browserWindow.isDestroyed()) return [];
      const bounds = managed.browserWindow.getBounds();
      const liveDisplay = this.#options.getDisplayMatching(bounds);
      return [{
        instanceId,
        targetDisplay: managed.targetDisplay,
        liveDisplay: String(liveDisplay.id),
        degraded: managed.degradedReason !== null,
        degradedReason: managed.degradedReason,
        bounds: { ...bounds },
      }];
    });
  }

  get size(): number {
    return this.#windows.size;
  }

  #selectDisplay(targetDisplay: string): ElectronDisplayLike {
    const displays = this.#options.getAllDisplays();
    const primary = this.#options.getPrimaryDisplay();
    if (targetDisplay === "primary") return primary;
    const selected = displays.find(({ id }) => String(id) === targetDisplay);
    if (selected === undefined) {
      throw new Error(`Assigned display ${targetDisplay} is unavailable.`);
    }
    return selected;
  }

  #emitGeometry(instanceId: string): void {
    const managed = this.#windows.get(instanceId);
    if (
      managed === undefined
      || managed.browserWindow.isDestroyed()
    ) return;
    const bounds = managed.browserWindow.getBounds();
    if (
      managed.suppressedBounds !== null
      && sameBounds(bounds, managed.suppressedBounds)
    ) {
      managed.suppressedBounds = null;
      return;
    }
    managed.suppressedBounds = null;
    const display = this.#options.getDisplayMatching(bounds);
    managed.targetDisplay = String(display.id);
    managed.relativeBounds = {
      x: bounds.x - display.bounds.x,
      y: bounds.y - display.bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    managed.degradedReason = null;
    this.#options.onWindowChanged({
      type: "overlay.window.changed",
      instanceId,
      targetDisplay: managed.targetDisplay,
      bounds: { ...managed.relativeBounds },
    });
  }

  #setBounds(managed: ManagedWindow, bounds: RectangleLike): void {
    managed.suppressedBounds = { ...bounds };
    managed.browserWindow.setBounds(bounds);
  }
}

function sameBounds(left: RectangleLike, right: RectangleLike): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function boundsFromSpec(spec: OverlayWindowSpec): RectangleLike {
  return {
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
  };
}

function absoluteRectangle(
  display: ElectronDisplayLike,
  bounds: RectangleLike,
): RectangleLike {
  return {
    x: display.bounds.x + bounds.x,
    y: display.bounds.y + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function fitWithinWorkArea(
  display: ElectronDisplayLike,
  bounds: RectangleLike,
): RectangleLike {
  const width = Math.min(bounds.width, display.workArea.width);
  const height = Math.min(bounds.height, display.workArea.height);
  return {
    x: Math.max(
      display.workArea.x,
      Math.min(bounds.x, display.workArea.x + display.workArea.width - width),
    ),
    y: Math.max(
      display.workArea.y,
      Math.min(bounds.y, display.workArea.y + display.workArea.height - height),
    ),
    width,
    height,
  };
}

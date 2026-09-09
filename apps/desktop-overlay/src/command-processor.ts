import { parseDesktopCommand } from "./commands.js";
import type { OverlayHostCommand } from "./types.js";

export interface DesktopWindowCommands {
  openWindow(command: Extract<OverlayHostCommand, { type: "overlay.window.open" }>): Promise<void>;
  updateWindow(window: Extract<OverlayHostCommand, { type: "overlay.window.update" }>["window"]): void;
  closeWindow(instanceId: string): void;
  reloadAll(): void;
}

export interface DesktopCommandResult {
  readonly type: "overlay.command.result";
  readonly commandId: string;
  readonly accepted: boolean;
  readonly error: string | null;
}

export interface DesktopCommandProcessorDependencies {
  readonly hostId: string;
  readonly windows: DesktopWindowCommands;
  readonly assertRendererUrl: (value: string, instanceId: string) => void;
  readonly emitResult: (result: DesktopCommandResult) => void;
  readonly onInvalid?: (error: string, issues?: unknown) => void;
  readonly onReceived?: (command: OverlayHostCommand) => void;
  readonly onCompleted?: (command: OverlayHostCommand) => void;
  readonly onFailed?: (command: OverlayHostCommand, error: string) => void;
}

export async function processDesktopCommand(raw: string, dependencies: DesktopCommandProcessorDependencies): Promise<void> {
  const parsed = parseDesktopCommand(raw);
  if (!parsed.ok) {
    dependencies.onInvalid?.(parsed.error, parsed.issues);
    return;
  }
  const command = parsed.command;
  if (command.hostId !== dependencies.hostId) {
    dependencies.emitResult({
      type: "overlay.command.result",
      commandId: command.commandId,
      accepted: false,
      error: `Command targets host ${command.hostId}, not ${dependencies.hostId}.`,
    });
    return;
  }
  dependencies.onReceived?.(command);
  try {
    if (command.type === "overlay.window.open") {
      dependencies.assertRendererUrl(command.window.rendererUrl, command.window.instanceId);
      await dependencies.windows.openWindow(command);
    } else if (command.type === "overlay.window.update") {
      dependencies.windows.updateWindow(command.window);
    } else if (command.type === "overlay.window.close") {
      dependencies.windows.closeWindow(command.instanceId);
    } else {
      dependencies.windows.reloadAll();
    }
    dependencies.emitResult({ type: "overlay.command.result", commandId: command.commandId, accepted: true, error: null });
    dependencies.onCompleted?.(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop overlay command failed.";
    dependencies.emitResult({ type: "overlay.command.result", commandId: command.commandId, accepted: false, error: message });
    dependencies.onFailed?.(command, message);
  }
}

export function commandInstanceId(command: OverlayHostCommand): string | null {
  if (command.type === "overlay.window.open" || command.type === "overlay.window.update") return command.window.instanceId;
  return command.type === "overlay.window.close" ? command.instanceId : null;
}

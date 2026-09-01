import { OverlayHostCommandSchema } from "@scarline/contracts";

import type { OverlayHostCommand } from "./types.js";

export type ParsedDesktopCommand =
  | { ok: true; command: OverlayHostCommand }
  | { ok: false; error: string; issues?: unknown };

export function parseDesktopCommand(raw: string): ParsedDesktopCommand {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Malformed JSON command.",
    };
  }
  const parsed = OverlayHostCommandSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid desktop overlay command.",
      issues: parsed.error.issues,
    };
  }
  return { ok: true, command: parsed.data };
}

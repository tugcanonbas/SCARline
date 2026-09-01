import { hostname } from "node:os";

const VALID_HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function resolveOverlayHostId(
  configured = process.env.SCARLINE_OVERLAY_HOST_ID,
  systemHostname = hostname(),
): string {
  const candidate = configured?.trim() || systemHostname.trim();
  if (!VALID_HOST_ID.test(candidate)) {
    throw new Error(
      "SCARLINE_OVERLAY_HOST_ID must be 1-128 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return candidate;
}

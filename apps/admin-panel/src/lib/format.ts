const ACRONYMS = new Set(["id", "rpc", "gnss", "imu", "url", "api"]);

/**
 * Turns a raw status/enum value (snake_case, kebab-case, or any casing) into
 * a consistent, readable label. "manual-trigger" -> "Manual Trigger".
 */
export function formatStatusLabel(
  value: string | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";

  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return ACRONYMS.has(lower) ? lower.toUpperCase() : capitalize(lower);
    })
    .join(" ");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Formats an ISO timestamp for display. Returns `fallback` for missing
 * values instead of leaking `undefined`/raw strings into the UI.
 */
export function formatDate(
  value: string | null | undefined,
  fallback = "Not recorded",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

/**
 * Shortens a long identifier (UUID, hash, etc.) for display, e.g. in a
 * fallback title when no human-readable name is available.
 */
export function shortId(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.length > 10 ? raw.slice(0, 8) : raw;
}

export function telemetryNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export type TelemetrySample = { timestamp: number; value: number | null };

export function appendTelemetryReading(history: TelemetrySample[], value: unknown, timestamp: unknown): TelemetrySample[] {
  const at = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(at) || at > Date.now() + 5_000 || at <= (history.at(-1)?.timestamp ?? -Infinity)) return history;
  return [...history.filter((point) => point.timestamp >= at - 60_000).slice(-599), { timestamp: at, value: telemetryNumber(value) }];
}

export function appendTelemetrySample(
  history: number[],
  nextValue: number,
  maximumLength = 60,
): number[] {
  return [...history.slice(-Math.max(1, maximumLength) + 1), nextValue];
}

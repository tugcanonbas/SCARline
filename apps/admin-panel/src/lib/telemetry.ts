export function telemetryNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function appendTelemetrySample(
  history: number[],
  nextValue: number,
  maximumLength = 60,
): number[] {
  return [...history.slice(-Math.max(1, maximumLength) + 1), nextValue];
}

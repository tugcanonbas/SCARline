export class ProjectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectError";
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

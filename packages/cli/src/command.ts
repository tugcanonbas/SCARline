export interface CommandContext {
  stdout(message: string): void;
  stderr(message: string): void;
  cwd: string;
}

export interface Command {
  readonly name: string;
  readonly description: string;
  run(args: readonly string[], context: CommandContext): Promise<number> | number;
}

import type { Command, CommandContext } from "./command.js";
import { commands } from "./commands/index.js";

const defaultContext: CommandContext = {
  stdout: console.log,
  stderr: console.error,
  cwd: process.cwd(),
};

function formatHelp(availableCommands: readonly Command[]): string {
  const commandLines = availableCommands.map(
    ({ name, description }) => `  ${name.padEnd(10)} ${description}`,
  );

  return [
    "Usage: scarline <command> [options]",
    "",
    "Commands:",
    ...commandLines,
    "",
    "Run scarline <command> --help for command-specific help.",
  ].join("\n");
}

function formatCommandHelp(command: Command): string {
  return [
    `Usage: scarline ${command.name} [options]`,
    "",
    command.description,
  ].join("\n");
}

export async function runCli(
  args: readonly string[],
  context: CommandContext = defaultContext,
): Promise<number> {
  const [commandName, ...commandArgs] = args;

  if (commandName === undefined || commandName === "--help" || commandName === "-h") {
    context.stdout(formatHelp(commands));
    return 0;
  }

  const command = commands.find(({ name }) => name === commandName);

  if (command === undefined) {
    context.stderr(`Unknown command: ${commandName}`);
    context.stderr("");
    context.stderr(formatHelp(commands));
    return 1;
  }

  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    context.stdout(formatCommandHelp(command));
    return 0;
  }

  return command.run(commandArgs, context);
}

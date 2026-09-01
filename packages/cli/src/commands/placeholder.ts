import type { Command } from "../command.js";

export function createPlaceholderCommand(
  name: string,
  description: string,
): Command {
  return {
    name,
    description,
    run(_args, context) {
      context.stdout(`The scarline ${name} command is not implemented yet.`);
      return 0;
    },
  };
}

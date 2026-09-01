import type { Command } from "../command.js";
import { doctorCommand } from "./doctor.js";
import { logsCommand } from "./logs.js";
import { restartCommand } from "./restart.js";
import { setupCommand } from "./setup.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";
import { stopCommand } from "./stop.js";

export const commands: readonly Command[] = [
  setupCommand,
  startCommand,
  stopCommand,
  restartCommand,
  statusCommand,
  doctorCommand,
  logsCommand,
];

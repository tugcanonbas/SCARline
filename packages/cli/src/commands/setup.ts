import path from "node:path";
import { ensureIoClientEnvironment } from "../project/python.js";

import type { Command } from "../command.js";
import {
  describeError,
  ensureEnvironmentSecrets,
  findRepositoryRoot,
  initializeRuntimeDirectories,
  loadProjectConfig,
} from "../project/index.js";

export const setupCommand: Command = {
  name: "setup",
  description: "Configure the local SCARline environment",
  async run(args, context) {
    if (args.length > 0) {
      context.stderr(`Unknown setup option: ${args[0]}`);
      return 1;
    }

    try {
      const repositoryRoot = await findRepositoryRoot(context.cwd);
      const project = await loadProjectConfig(repositoryRoot);
      const environment = await ensureEnvironmentSecrets(repositoryRoot);
      await initializeRuntimeDirectories(project);
      const ioPython = await ensureIoClientEnvironment(repositoryRoot, project);

      context.stdout("SCARline setup complete.");
      context.stdout(`Repository: ${repositoryRoot}`);
      context.stdout("Configuration: config.yml is valid");
      context.stdout(
        environment.created
          ? `.env: created with ${environment.generatedKeys.length} secret values`
          : environment.generatedKeys.length > 0
            ? `.env: preserved existing values and added ${environment.generatedKeys.length} missing secret values`
            : ".env: valid; existing secrets preserved",
      );
      context.stdout(
        `Runtime: ${path.relative(repositoryRoot, project.runtimeDirectory) || "."}`,
      );
      context.stdout(`IO Client Python: ${ioPython}`);
      return 0;
    } catch (error) {
      context.stderr(`Setup failed: ${describeError(error)}`);
      return 1;
    }
  },
};

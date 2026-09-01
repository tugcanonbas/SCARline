import type { Command } from "../command.js";
import {
  type ComposeRunner,
  defaultComposeRunner,
  composeArguments,
  formatComposeFailure,
  loadInfrastructureContext,
  queryInfrastructureStatus,
} from "../infrastructure/compose.js";
import { writePlatformState } from "../infrastructure/state.js";
import { describeError } from "../project/index.js";
import {
  desktopOverlayProcessManager,
  type DesktopOverlayProcessManager,
} from "../processes/desktop-overlay.js";
import { ioClientProcessManager, type IoClientProcessManager } from "../processes/io-client.js";
import { carlaServerProcessManager, type CarlaServerProcessManager } from "../processes/carla-server.js";

export function createStopCommand(
  runner: ComposeRunner = defaultComposeRunner,
  desktopOverlay: DesktopOverlayProcessManager = desktopOverlayProcessManager,
  ioClient: IoClientProcessManager = ioClientProcessManager,
  carlaServer: CarlaServerProcessManager = carlaServerProcessManager,
): Command {
  return {
    name: "stop",
    description: "Stop SCARline services",
    async run(args, commandContext) {
      if (args.length > 0) {
        commandContext.stderr(`Unknown stop option: ${args[0]}`);
        return 1;
      }

      try {
        const infrastructure = await loadInfrastructureContext(commandContext.cwd);
        const currentStatus = await queryInfrastructureStatus(
          infrastructure,
          runner,
        );

        await desktopOverlay.stop(infrastructure);
        await ioClient.stop(infrastructure);

        if (currentStatus.phase === "stopped") {
          await carlaServer.stop(infrastructure);
          await writePlatformState(infrastructure, "stopped", []);
          commandContext.stdout("SCARline infrastructure is already stopped.");
          return 0;
        }

        commandContext.stdout("Stopping SCARline platform...");
        const composeArgs = [
          ...composeArguments(infrastructure),
          "--profile",
          "mock",
          "--profile",
          "io-docker",
          "--profile",
          "carla",
          "down",
          "--timeout",
          String(infrastructure.config.platform.shutdown_timeout_seconds),
        ];
        if (infrastructure.config.docker.remove_orphans) {
          composeArgs.push("--remove-orphans");
        }

        const result = await runner.run(composeArgs, {
          cwd: infrastructure.repositoryRoot,
          timeoutMilliseconds:
            (infrastructure.config.platform.shutdown_timeout_seconds + 30) * 1_000,
        });
        if (result.exitCode !== 0) {
          throw new Error(
            formatComposeFailure(
              result,
              infrastructure.secretValues,
              "Docker Compose could not stop the infrastructure",
            ),
          );
        }

        const status = await queryInfrastructureStatus(infrastructure, runner);
        await writePlatformState(infrastructure, status.phase, status.services);
        if (status.phase !== "stopped") {
          throw new Error(
            `Infrastructure did not stop cleanly; current state is ${status.phase}.`,
          );
        }

        await carlaServer.stop(infrastructure);

        commandContext.stdout(
          "SCARline infrastructure stopped. Runtime data was preserved.",
        );
        return 0;
      } catch (error) {
        commandContext.stderr(`Stop failed: ${describeError(error)}`);
        return 1;
      }
    },
  };
}

export const stopCommand = createStopCommand();

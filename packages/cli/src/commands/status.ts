import type { Command } from "../command.js";
import {
  type ComposeRunner,
  defaultComposeRunner,
  loadInfrastructureContext,
  missingComposeServices,
  queryInfrastructureStatus,
} from "../infrastructure/compose.js";
import { printServiceStatus } from "../infrastructure/format.js";
import { writePlatformState } from "../infrastructure/state.js";
import { describeError } from "../project/index.js";
import {
  desktopOverlayProcessManager,
  type DesktopOverlayProcessManager,
} from "../processes/desktop-overlay.js";
import { ioClientProcessManager, type IoClientProcessManager } from "../processes/io-client.js";
import { carlaServerProcessManager, type CarlaServerProcessManager } from "../processes/carla-server.js";

export function createStatusCommand(
  runner: ComposeRunner = defaultComposeRunner,
  desktopOverlay: DesktopOverlayProcessManager = desktopOverlayProcessManager,
  ioClient: IoClientProcessManager = ioClientProcessManager,
  carlaServer: CarlaServerProcessManager = carlaServerProcessManager,
): Command {
  return {
    name: "status",
    description: "Show the status of SCARline services",
    async run(args, commandContext) {
      if (args.length > 0) {
        commandContext.stderr(`Unknown status option: ${args[0]}`);
        return 1;
      }

      try {
        const infrastructure = await loadInfrastructureContext(commandContext.cwd);
        const status = await queryInfrastructureStatus(infrastructure, runner);
        const desktop = await desktopOverlay.status(infrastructure);
        const io = await ioClient.status(infrastructure);
        const carla = await carlaServer.status(infrastructure);
        const mockRunning = status.services.some(({ service, state }) => service === "mock-simulator" && state === "running");
        const carlaClientRunning = status.services.some(({ service, state }) => service === "carla-client" && state === "running");
        const carlaPresent = carla.running || carlaClientRunning;
        const carlaBroken = (carla.running && !carla.healthy) || carla.running !== carlaClientRunning;
        const missing = missingComposeServices(infrastructure, status, mockRunning, carlaPresent);
        const effectivePhase = carlaBroken ? "degraded" : status.phase;
        await writePlatformState(infrastructure, effectivePhase, status.services);

        commandContext.stdout(`desktop-overlay: ${desktop.running ? `running, PID ${desktop.pid}` : "stopped"}`);
        const dockerIo = infrastructure.config.services.io_client.enabled && infrastructure.config.services.io_client.runtime === "docker";
        commandContext.stdout(dockerIo ? "io-client: managed by Docker Compose" : `io-client: ${io.running ? `${io.healthy ? "healthy" : "unhealthy"}, PID ${io.pid}${io.mockEnabled ? ", mock sensors enabled" : ""}` : "stopped"}`);
        commandContext.stdout(`carla-server: ${carla.running ? `${carla.healthy ? "healthy" : "unhealthy"}, PID ${carla.pid}` : "stopped"}`);

        if (status.phase === "stopped") {
          commandContext.stdout(`SCARline infrastructure is ${effectivePhase}.`);
          return desktop.running || (!dockerIo && io.running) || carla.running ? 1 : 0;
        }

        if (missing.length > 0) commandContext.stdout(`missing services: ${missing.join(", ")}`);

        commandContext.stdout(`SCARline infrastructure is ${effectivePhase}.`);
        printServiceStatus(status, commandContext);
        const desktopMissing = infrastructure.config.services.desktop_overlay.enabled && !desktop.running;
        const ioMissing = infrastructure.config.services.io_client.enabled && !dockerIo && (!io.running || !io.healthy);
        return effectivePhase === "degraded" || desktopMissing || ioMissing || missing.length > 0 ? 1 : 0;
      } catch (error) {
        commandContext.stderr(`Status failed: ${describeError(error)}`);
        return 1;
      }
    },
  };
}

export const statusCommand = createStatusCommand();

import type { Command } from "../command.js";
import {
  type ComposeRunner,
  defaultComposeRunner,
  composeArguments,
  formatComposeFailure,
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
import {
  carlaServerProcessManager,
  type CarlaServerProcessManager,
} from "../processes/carla-server.js";

type SimulatorSelection = "carla" | "mock" | null;

function selectSimulator(
  args: readonly string[],
  infrastructure: Awaited<ReturnType<typeof loadInfrastructureContext>>,
): SimulatorSelection {
  const simulatorArgs=args.filter((value)=>value!=="--mock-io");
  if (simulatorArgs.length === 0) {
    return infrastructure.config.simulator.autostart
      ? infrastructure.config.simulator.default
      : null;
  }
  if (simulatorArgs.length === 1 && simulatorArgs[0] === "--no-sim") return "mock";
  if (
    simulatorArgs.length === 2
    && simulatorArgs[0] === "--simulator"
    && (simulatorArgs[1] === "carla" || simulatorArgs[1] === "mock")
  ) {
    return simulatorArgs[1];
  }
  throw new Error(
    "Usage: scarline start [--no-sim | --simulator carla|mock] [--mock-io]",
  );
}

export function createStartCommand(
  runner: ComposeRunner = defaultComposeRunner,
  desktopOverlay: DesktopOverlayProcessManager = desktopOverlayProcessManager,
  ioClient: IoClientProcessManager = ioClientProcessManager,
  platform: NodeJS.Platform = process.platform,
  carlaServer: CarlaServerProcessManager = carlaServerProcessManager,
): Command {
  return {
    name: "start",
    description: "Start SCARline services",
    async run(args, commandContext) {
      try {
        const infrastructure = await loadInfrastructureContext(commandContext.cwd);
        const simulator = selectSimulator(args, infrastructure);
        const mockIo = args.includes("--mock-io") || infrastructure.config.services.io_client.mock_enabled;
        const dockerIo = infrastructure.config.services.io_client.enabled && infrastructure.config.services.io_client.runtime === "docker";
        if (simulator === "mock" && !infrastructure.config.simulator.mock.enabled) {
          throw new Error("Mock Simulator is disabled in config.yml.");
        }
        if (simulator === "carla" && platform !== "linux" && platform !== "win32") {
          throw new Error("CARLA 0.9.16 requires a supported Linux or Windows host. Use --no-sim on this OS.");
        }
        const carlaHostBeforeStart = await carlaServer.status(infrastructure);
        const currentStatus = await queryInfrastructureStatus(
          infrastructure,
          runner,
        );

        const mockPresent = currentStatus.services.some(({ service }) => service === "mock-simulator");
        const mockRunning = currentStatus.services.some(({ service, state }) => service === "mock-simulator" && state === "running");
        const carlaPresent = carlaHostBeforeStart.running || currentStatus.services.some(({ service }) => service === "carla-client");
        const carlaRunning = currentStatus.services.some(({ service, state }) => service === "carla-client" && state === "running");
        const missingServices = missingComposeServices(
          infrastructure,
          currentStatus,
          simulator === "mock",
          simulator === "carla",
        );
        if (simulator !== "mock" && mockPresent) {
          throw new Error(
            "Mock Simulator is already running. Stop SCARline before switching simulator types.",
          );
        }
        if (simulator !== "carla" && carlaPresent) {
          throw new Error(
            "CARLA is already running. Stop SCARline before switching simulator types.",
          );
        }
        let startedCarlaHere = false;
        let carlaHost = carlaHostBeforeStart;
        if (simulator === "carla") {
          carlaHost = await carlaServer.start(infrastructure);
          startedCarlaHere = !carlaHostBeforeStart.running;
          commandContext.stdout(`CARLA host server: healthy, PID ${carlaHost.pid}`);
        }
        if (currentStatus.phase === "running" && missingServices.length === 0 && (simulator !== "mock" || mockRunning) && (simulator !== "carla" || (carlaRunning && carlaHost.healthy))) {
          if (infrastructure.config.services.desktop_overlay.enabled) {
            const desktop = await desktopOverlay.start(infrastructure);
            commandContext.stdout(`Desktop overlay: running (PID ${desktop.pid})`);
          }
          if (infrastructure.config.services.io_client.enabled && !dockerIo) { const io=await ioClient.start(infrastructure,mockIo); commandContext.stdout(`IO Client: running (PID ${io.pid}${io.mockEnabled?", mock sensors enabled":""})`); }
          await writePlatformState(
            infrastructure,
            currentStatus.phase,
            currentStatus.services,
          );
          commandContext.stdout("SCARline infrastructure is already running.");
          printServiceStatus(currentStatus, commandContext);
          return 0;
        }

        commandContext.stdout("Starting SCARline infrastructure...");
        const composeArgs = [
          ...composeArguments(infrastructure),
          ...(simulator === "mock" ? ["--profile", "mock"] : []),
          ...(simulator === "carla" ? ["--profile", "carla"] : []),
          ...(dockerIo ? ["--profile", "io-docker"] : []),
          "up",
          "--detach",
          "--build",
          "--wait",
          "--wait-timeout",
          String(infrastructure.config.platform.startup_timeout_seconds),
        ];
        if (infrastructure.config.docker.remove_orphans) {
          composeArgs.push("--remove-orphans");
        }

        let result;
        try {
          result = await runner.run(composeArgs, {
            cwd: infrastructure.repositoryRoot,
            timeoutMilliseconds:
              (infrastructure.config.platform.startup_timeout_seconds + 60) * 1_000,
          });
        } catch (error) {
          if (startedCarlaHere) await carlaServer.stop(infrastructure);
          throw error;
        }
        if (result.exitCode !== 0) {
          if (startedCarlaHere) await carlaServer.stop(infrastructure);
          await writePlatformState(infrastructure, "degraded", []);
          throw new Error(
            formatComposeFailure(
              result,
              infrastructure.secretValues,
              "Docker Compose could not start the infrastructure",
            ),
          );
        }

        let status;
        try {
          status = await queryInfrastructureStatus(infrastructure, runner);
        } catch (error) {
          if (startedCarlaHere) await carlaServer.stop(infrastructure);
          throw error;
        }
        await writePlatformState(infrastructure, status.phase, status.services);
        const missingAfterStart = missingComposeServices(
          infrastructure,
          status,
          simulator === "mock",
          simulator === "carla",
        );
        if (status.phase !== "running" || missingAfterStart.length > 0) {
          if (startedCarlaHere) await carlaServer.stop(infrastructure);
          printServiceStatus(status, commandContext);
          throw new Error(
            missingAfterStart.length > 0
              ? `Infrastructure did not start every required service: ${missingAfterStart.join(", ")}.`
              : `Infrastructure did not become healthy; current state is ${status.phase}.`,
          );
        }

        if (infrastructure.config.services.desktop_overlay.enabled) {
          const desktop = await desktopOverlay.start(infrastructure);
          commandContext.stdout(`Desktop overlay: running (PID ${desktop.pid})`);
        }
        if (infrastructure.config.services.io_client.enabled && !dockerIo) { const io=await ioClient.start(infrastructure,mockIo); commandContext.stdout(`IO Client: running (PID ${io.pid}${io.mockEnabled?", mock sensors enabled":""})`); }
        if (dockerIo) commandContext.stdout("IO Client: running in Docker");

        commandContext.stdout("SCARline infrastructure started.");
        if (simulator === "mock") {
          commandContext.stdout("Simulator: Mock Simulator adapter");
        } else if (simulator === "carla") {
          commandContext.stdout("Simulator: CARLA 0.9.16 host server with Docker adapter");
        } else {
          commandContext.stdout("Simulator: automatic client startup is disabled.");
        }
        printServiceStatus(status, commandContext);
        return 0;
      } catch (error) {
        commandContext.stderr(`Start failed: ${describeError(error)}`);
        return 1;
      }
    },
  };
}

export const startCommand = createStartCommand();

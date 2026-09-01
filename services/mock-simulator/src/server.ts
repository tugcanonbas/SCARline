import { loadMockSimulatorConfig } from "./config.js";
import { MockSimulatorClient } from "./client.js";

const config = await loadMockSimulatorConfig();
if (!config.project.simulator.mock.enabled) {
  throw new Error("Mock Simulator is disabled in config.yml.");
}
const client = new MockSimulatorClient(config);
await client.start();
let closing = false;

function close(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`Stopping Mock Simulator after ${signal}.`);
  client.stop();
}

process.once("SIGINT", () => close("SIGINT"));
process.once("SIGTERM", () => close("SIGTERM"));

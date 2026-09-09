import { buildApp } from "./app.js";
import { loadSimBridgeConfig } from "./config.js";

const config = await loadSimBridgeConfig();
const app = await buildApp(config);
let closing = false;

async function close(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "Shutting down Sim Bridge");
  await app.close().catch((error) => {
    app.log.error({ err: error }, "Sim Bridge shutdown failed");
    process.exitCode = 1;
  });
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({
    host: "0.0.0.0",
    port: config.project.sim_bridge.port,
  });
} catch (error) {
  app.log.error({ err: error }, "Sim Bridge startup failed");
  await app.close().catch(() => undefined);
  process.exitCode = 1;
}

import { buildApp } from "./app.js";
import { loadCoreApiConfig } from "./config.js";

const config = await loadCoreApiConfig();
const app = await buildApp({ config });
let closing = false;

async function close(signal: string): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  app.log.info({ signal }, "shutting down CoreAPI");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "CoreAPI shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({
    host: "0.0.0.0",
    port: config.project.platform.port,
  });
} catch (error) {
  app.log.error({ err: error }, "CoreAPI startup failed");
  await app.close().catch(() => undefined);
  process.exitCode = 1;
}

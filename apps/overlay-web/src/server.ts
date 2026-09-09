import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyReply } from "fastify";

export interface OverlayWebOptions {
  coreApiOrigin: string;
  coreApiWebSocketOrigin: string;
  widgetsDirectory: string;
  rendererAssetsDirectory?: string;
  logger?: boolean;
}

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export function buildOverlayWeb(options: OverlayWebOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const widgetsDirectory = path.resolve(options.widgetsDirectory);
  const rendererAssetsDirectory = path.resolve(options.rendererAssetsDirectory ?? sourceDirectory);

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    return payload;
  });

  app.get("/healthz", async (_request, reply) => {
    noStore(reply);
    return { status: "ok", component: "overlay-web" };
  });

  app.get("/runtime-config.json", async (_request, reply) => {
    noStore(reply);
    return {
      coreApiOrigin: options.coreApiOrigin,
      coreApiWebSocketOrigin: options.coreApiWebSocketOrigin,
    };
  });

  app.get("/client.js", async (_request, reply) =>
    sendFile(reply, path.join(rendererAssetsDirectory, "client.js"), "text/javascript; charset=utf-8"));
  app.get("/bridge.js", async (_request, reply) =>
    sendFile(reply, path.join(rendererAssetsDirectory, "bridge.js"), "text/javascript; charset=utf-8"));
  app.get("/browser-position.js", async (_request, reply) =>
    sendFile(reply, path.join(rendererAssetsDirectory, "browser-position.js"), "text/javascript; charset=utf-8"));
  app.get("/favicon.ico", async (_request, reply) => {
    reply.type("image/x-icon");
    reply.header("cache-control", "public, max-age=86400");
    return reply.send(Buffer.from(ADMIN_FAVICON_BASE64, "base64"));
  });

  for (const route of ["/launcher/:layoutId", "/widget/:instanceId"]) {
    app.get(route, async (_request, reply) => {
      noStore(reply);
      reply.type("text/html; charset=utf-8");
      reply.header("content-security-policy", contentSecurityPolicy(options));
      return overlayShell();
    });
  }

  app.get("/assets/*", async (request, reply) => {
    const requested = wildcard(request.params);
    return sendWidgetFile(reply, widgetsDirectory, path.join("components", requested));
  });

  for (const prefix of ["images", "icons"]) {
    app.get(`/${prefix}/*`, async (request, reply) => {
      const requested = wildcard(request.params);
      return sendWidgetFile(reply, widgetsDirectory, path.join(prefix, requested));
    });
  }

  app.get("/dist.css", async (_request, reply) =>
    sendWidgetFile(reply, widgetsDirectory, "dist.css"));
  app.get("/widget-runtime.js", async (_request, reply) =>
    sendWidgetFile(reply, widgetsDirectory, "widget-runtime.js"));

  return app;
}

function wildcard(params: unknown): string {
  const value = (params as Record<string, unknown>)["*"];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Static asset path is required.");
  }
  return value;
}

async function sendWidgetFile(reply: FastifyReply, root: string, requested: string) {
  try {
    const resolved = await safeFilePath(root, requested);
    return sendFile(reply, resolved, contentType(resolved));
  } catch (error) {
    if (error instanceof InvalidAssetPathError || (error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply.status(404).send({ error: "Not found" });
    }
    throw error;
  }
}

class InvalidAssetPathError extends Error {}

export function safePath(root: string, requested: string): string {
  if (requested.includes("\0")) throw new InvalidAssetPathError("Invalid asset path.");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new InvalidAssetPathError("Invalid asset path.");
  }
  return resolved;
}

export async function safeFilePath(root: string, requested: string): Promise<string> {
  const candidate = safePath(root, requested);
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    fs.realpath(path.resolve(root)),
    fs.realpath(candidate),
  ]);
  if (
    resolvedCandidate !== resolvedRoot
    && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new InvalidAssetPathError("Invalid asset path.");
  }
  return resolvedCandidate;
}

async function sendFile(reply: FastifyReply, file: string, type: string) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return reply.status(404).send({ error: "Not found" });
    const contents = await fs.readFile(file);
    reply.type(type);
    reply.header("cache-control", file.endsWith(".html") ? "no-store" : "public, max-age=300");
    return reply.send(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply.status(404).send({ error: "Not found" });
    }
    throw error;
  }
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}

function contentSecurityPolicy(options: OverlayWebOptions): string {
  const connectSources = [options.coreApiOrigin, options.coreApiWebSocketOrigin]
    .map((value) => new URL(value).origin)
    .join(" ");
  return [
    "default-src 'none'",
    "base-uri 'none'",
    `connect-src 'self' ${connectSources}`,
    "frame-src 'self'",
    "img-src 'self' data:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}

function overlayShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SCARline Overlay</title>
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="stylesheet" href="/overlay-shell.css" />
  </head>
  <body>
    <main id="app" aria-live="polite"><p class="status">Connecting to SCARline…</p></main>
    <script type="module" src="/client.js"></script>
  </body>
</html>`;
}

const ADMIN_FAVICON_BASE64 = "AAABAAEAICAAAAEAIACCAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAgAAAAIAgGAAAAc3p69AAAAElJREFUeNpj4OKX+T+QmGHUAaMOwCbofOQ/TfCoA4auA77+QMW4EhS6ulEHjDpg1AGjDhh1wKgDho8DRtsDI88Bo/2CUQfQEwMAGa8LqficacUAAAAASUVORK5CYII=";

const options: OverlayWebOptions = {
  coreApiOrigin: process.env.CORE_API_PUBLIC_ORIGIN ?? "http://localhost:8088",
  coreApiWebSocketOrigin: process.env.CORE_API_PUBLIC_WS_ORIGIN ?? "ws://localhost:8088",
  widgetsDirectory: path.resolve(process.env.WIDGETS_DIRECTORY ?? path.join(process.cwd(), "../../widgets")),
  logger: true,
};

const app = buildOverlayWeb(options);
app.get("/overlay-shell.css", async (_request, reply) => {
  reply.type("text/css; charset=utf-8");
  return shellStyles;
});

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? "4000");
  await app.listen({ host: "0.0.0.0", port });
}

const shellStyles = `
:root { color-scheme: dark; font: 14px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; background: transparent; }
* { box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; margin: 0; }
body { overflow: hidden; background: transparent; color: #f8fafc; }
.status, .error { margin: 20px; padding: 12px 14px; border-radius: 10px; background: rgba(15,23,42,.92); }
.error { color: #fecaca; border: 1px solid rgba(248,113,113,.35); }
.launcher { min-height: 100%; overflow: auto; padding: 24px; background: #090d15; }
.launcher h1 { margin: 0 0 8px; font-size: 20px; }
.launcher p { margin: 0 0 18px; color: #94a3b8; }
.launcher-list { display: grid; gap: 10px; max-width: 680px; }
.launcher-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px; border: 1px solid #263244; border-radius: 10px; background: #101722; }
.launcher-row button { border: 1px solid #3b82f6; border-radius: 8px; padding: 8px 12px; color: white; background: #2563eb; cursor: pointer; }
.launcher-row button[data-open='true'] { border-color: #334155; background: #1e293b; color: #94a3b8; }
.widget-shell { width: 100%; height: 100%; position: relative; }
.widget-frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
.browser-toolbar { position: fixed; z-index: 5; top: 6px; right: 6px; max-width: calc(100% - 12px); padding: 3px 7px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; background: rgba(15,23,42,.7); color: rgba(255,255,255,.72); font-size: 10px; line-height: 1.2; pointer-events: none; backdrop-filter: blur(8px); }
`;

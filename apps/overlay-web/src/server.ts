import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4000);
const widgetsDir = path.resolve(process.cwd(), "../../widgets");
const widgetsComponentsDir = path.join(widgetsDir, "components");
const publicDir = path.resolve(process.cwd(), "public");
const coreApiOrigin = process.env.CORE_API_ORIGIN ?? "";
const publicWsUrl = process.env.PUBLIC_WS_URL ?? "";
const overlayControlOrigin =
  process.env.OVERLAY_CONTROL_ORIGIN ?? "http://127.0.0.1:4097";

const app = Fastify({
  logger: true,
});

function setNoCache(reply: {
  header: (name: string, value: string) => unknown;
}): void {
  reply.header(
    "cache-control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
}

const validWidgetCategories = new Set([
  "driving",
  "communication",
  "health",
  "study",
  "general",
]);
const validBindingTypes = new Set([
  "number",
  "string",
  "boolean",
  "object",
  "array",
]);
const validTriggerActions = new Set([
  "show",
  "hide",
  "highlight",
  "reset",
  "toggle",
  "notify",
  "update",
]);

function assertSafeAssetPath(widgetId: string, file: string): void {
  if (!/^[a-z0-9-]+$/.test(widgetId) || !/^[a-zA-Z0-9._-]+$/.test(file)) {
    throw new Error("Invalid overlay asset path");
  }
}

function resolveSafeStaticPath(baseDir: string, requestedPath: string): string {
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(baseDir, normalized);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error("Invalid overlay static path");
  }
  return resolved;
}

async function widgetCatalogueDir(): Promise<string> {
  try {
    await fs.access(widgetsComponentsDir);
    return widgetsComponentsDir;
  } catch {
    return widgetsDir;
  }
}

async function resolveWidgetDir(widgetId: string): Promise<string> {
  const catalogueDir = await widgetCatalogueDir();
  return path.join(catalogueDir, widgetId);
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "text/html";
}

function validateWidgetMetadata(
  metadata: Record<string, unknown>,
  widgetId: string,
): string[] {
  const errors: string[] = [];
  if (metadata.id !== widgetId)
    errors.push("metadata id must match widget directory");
  if (typeof metadata.name !== "string" || !metadata.name)
    errors.push("name is required");
  if (typeof metadata.description !== "string" || !metadata.description)
    errors.push("description is required");
  if (metadata.entry !== "index.html") errors.push("entry must be index.html");
  if (
    typeof metadata.category !== "string" ||
    !validWidgetCategories.has(metadata.category)
  ) {
    errors.push("category must be a supported widget category");
  }
  const bindingsValue = metadata.bindings;
  const actionsValue = metadata.actions;
  const triggersValue = metadata.triggers;
  const bindingsArray = Array.isArray(bindingsValue)
    ? bindingsValue
    : bindingsValue && typeof bindingsValue === "object"
      ? Object.entries(bindingsValue as Record<string, unknown>).map(
          ([key, value]) => ({ key, ...(value as object) }),
        )
      : null;
  if (!bindingsArray) errors.push("bindings must be an array or object map");
  if (bindingsArray) {
    const bindingKeys = new Set<string>();
    for (const [index, binding] of bindingsArray.entries()) {
      if (typeof binding !== "object" || binding === null) {
        errors.push(`bindings.${index} must be an object`);
        continue;
      }

      const entry = binding as Record<string, unknown>;
      if (
        typeof entry.key !== "string" ||
        !/^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)+$/.test(entry.key)
      ) {
        errors.push(`bindings.${index}.key must be a dotted binding path`);
      } else if (bindingKeys.has(entry.key)) {
        errors.push(`bindings.${index}.key must be unique`);
      } else {
        bindingKeys.add(entry.key);
      }

      if (
        typeof entry.type !== "string" ||
        !validBindingTypes.has(entry.type)
      ) {
        errors.push(`bindings.${index}.type must be supported`);
      }
    }
  }
  const triggerItems = Array.isArray(triggersValue)
    ? triggersValue
    : actionsValue && typeof actionsValue === "object"
      ? Object.entries(actionsValue as Record<string, unknown>).map(
          ([action, value]) => ({ action, ...(value as object) }),
        )
      : [];
  if (triggerItems.length > 0) {
    const triggerActions = new Set<string>();
    for (const [index, trigger] of triggerItems.entries()) {
      if (typeof trigger !== "object" || trigger === null) {
        errors.push(`triggers.${index} must be an object`);
        continue;
      }

      const entry = trigger as Record<string, unknown>;
      if (
        typeof entry.action !== "string" ||
        !validTriggerActions.has(entry.action)
      ) {
        errors.push(`triggers.${index}.action must be supported`);
      } else if (triggerActions.has(entry.action)) {
        errors.push(`triggers.${index}.action must be unique`);
      } else {
        triggerActions.add(entry.action);
      }

      if (typeof entry.description !== "string" || !entry.description) {
        errors.push(`triggers.${index}.description is required`);
      }
    }
  }
  if (typeof metadata.ui !== "object" || metadata.ui === null) {
    errors.push("ui sizing metadata is required");
  } else {
    const ui = metadata.ui as Record<string, unknown>;
    if ("minWidth" in ui || "preferredWidth" in ui) {
      for (const key of [
        "minWidth",
        "minHeight",
        "preferredWidth",
        "preferredHeight",
      ]) {
        if (typeof ui[key] !== "number" || Number(ui[key]) <= 0) {
          errors.push(`ui.${key} must be a positive number`);
        }
      }
    } else {
      const minSize = ui.minSize as Record<string, unknown> | undefined;
      const preferredSize = ui.preferredSize as
        | Record<string, unknown>
        | undefined;
      if (
        !minSize ||
        typeof minSize.w !== "number" ||
        typeof minSize.h !== "number" ||
        minSize.w <= 0 ||
        minSize.h <= 0
      ) {
        errors.push("ui.minSize.w/h must be positive numbers");
      }
      if (
        !preferredSize ||
        typeof preferredSize.w !== "number" ||
        typeof preferredSize.h !== "number" ||
        preferredSize.w <= 0 ||
        preferredSize.h <= 0
      ) {
        errors.push("ui.preferredSize.w/h must be positive numbers");
      }
    }
  }
  return errors;
}

function htmlShell() {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>SCARline Overlay</title>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          color: #000;
          font-family: system-ui, sans-serif;
          overflow: hidden;
        }
      </style>
    </head>
    <body>
      <div id="app"></div>
      <script>
        window.__SCARLINE_API_ORIGIN = ${JSON.stringify(coreApiOrigin)};
        window.__SCARLINE_WS_URL = ${JSON.stringify(publicWsUrl)};
        window.__SCARLINE_OVERLAY_CONTROL_ORIGIN = ${JSON.stringify(overlayControlOrigin)};
      </script>
      <script type="module" src="/overlay/app.js"></script>
    </body>
  </html>`;
}

function injectWidgetStylesheetRuntime(html: string): string {
  const criticalTransparentRuntime = `
    <style data-scarline-widget-critical>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent !important;
        background-color: transparent !important;
      }
    </style>
  `;
  const distCssRuntime = html.includes("dist.css")
    ? ""
    : '<link rel="stylesheet" href="/overlay/dist.css" />';
  const runtime = `${criticalTransparentRuntime}${distCssRuntime}`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${runtime}</head>`);
  }
  return `${runtime}${html}`;
}

function escapeInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

function widgetPreviewBindingDefaults(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const bindingsValue = metadata.bindings;
  const bindings = Array.isArray(bindingsValue)
    ? bindingsValue
    : bindingsValue && typeof bindingsValue === "object"
      ? Object.entries(bindingsValue as Record<string, unknown>).map(
          ([key, value]) => ({ key, ...(value as object) }),
        )
      : [];

  return Object.fromEntries(
    bindings.flatMap((binding) => {
      if (typeof binding !== "object" || binding === null) {
        return [];
      }

      const entry = binding as Record<string, unknown>;
      if (typeof entry.key !== "string" || !("default" in entry)) {
        return [];
      }

      return [[entry.key, entry.default]];
    }),
  );
}

function injectWidgetPreviewRuntime(
  html: string,
  metadata: Record<string, unknown>,
): string {
  const previewRuntime = `
    <style data-scarline-widget-preview>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent !important;
        background-color: transparent !important;
        pointer-events: none !important;
      }

      body > *:first-child {
        pointer-events: none !important;
      }
    </style>
    <script data-scarline-widget-preview-runtime>
      (() => {
        const metadata = ${escapeInlineScript(metadata)};
        const defaults = ${escapeInlineScript(widgetPreviewBindingDefaults(metadata))};
        const bindings = new Map(Object.entries(defaults));
        const bindingHandlers = new Map();
        const stateHandlers = [];
        const currentState = "visible";
        const blockedNetwork = (api) => () => Promise.reject(new Error("SCARline admin preview blocks " + api));

        window.fetch = blockedNetwork("fetch");
        window.WebSocket = function BlockedWebSocket() {
          throw new Error("SCARline admin preview blocks WebSocket");
        };
        window.EventSource = function BlockedEventSource() {
          throw new Error("SCARline admin preview blocks EventSource");
        };
        window.XMLHttpRequest = class BlockedXMLHttpRequest {
          open() {
            throw new Error("SCARline admin preview blocks XMLHttpRequest");
          }
          send() {
            throw new Error("SCARline admin preview blocks XMLHttpRequest");
          }
        };

        const queueBinding = (key, callback) => {
          if (!bindings.has(key)) {
            return;
          }
          queueMicrotask(() => callback(bindings.get(key)));
        };

        window.SCARline = {
          onBinding(key, callback) {
            const handlers = bindingHandlers.get(key) ?? [];
            handlers.push(callback);
            bindingHandlers.set(key, handlers);
            queueBinding(key, callback);
          },
          onTrigger() {},
          onStateChange(callback) {
            stateHandlers.push(callback);
            queueMicrotask(() => callback(currentState));
          },
          ready() {},
          getBinding(key) {
            return bindings.get(key);
          },
          getState() {
            return currentState;
          },
          getMetadata() {
            return metadata;
          },
          send() {
            return false;
          }
        };

        document.documentElement.dataset.scarlinePreview = "admin";
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.setProperty("background", "transparent", "important");
          document.documentElement.style.setProperty("background-color", "transparent", "important");
          document.body.style.setProperty("background", "transparent", "important");
          document.body.style.setProperty("background-color", "transparent", "important");
        }, { once: true });
      })();
    </script>
  `;

  if (html.includes("</head>")) {
    return html.replace("</head>", `${previewRuntime}</head>`);
  }
  return `${previewRuntime}${html}`;
}

app.get("/health", async () => ({
  status: "healthy",
  mode: process.env.WIDGET_TEST_MODE === "true" ? "widget-test" : "runtime",
}));

app.get("/app.js", async (_request, reply) => {
  setNoCache(reply);
  const file = await fs.readFile(path.join(publicDir, "app.js"), "utf8");
  reply.type("text/javascript").send(file);
});

app.get("/overlay/app.js", async (_request, reply) => {
  setNoCache(reply);
  const file = await fs.readFile(path.join(publicDir, "app.js"), "utf8");
  reply.type("text/javascript").send(file);
});

app.get("/assets/:widgetId/:file", async (request, reply) => {
  const params = request.params as { widgetId: string; file: string };
  const query = request.query as { preview?: string };
  assertSafeAssetPath(params.widgetId, params.file);
  const filePath = path.join(
    await resolveWidgetDir(params.widgetId),
    params.file,
  );
  if (params.file.endsWith(".html")) {
    setNoCache(reply);
    const html = await fs.readFile(filePath, "utf8");
    let responseHtml = injectWidgetStylesheetRuntime(html);
    if (query.preview === "admin") {
      const metadataRaw = await fs.readFile(
        path.join(await resolveWidgetDir(params.widgetId), "widget.json"),
        "utf8",
      );
      responseHtml = injectWidgetPreviewRuntime(
        responseHtml,
        JSON.parse(metadataRaw) as Record<string, unknown>,
      );
    }
    reply.type("text/html").send(responseHtml);
    return;
  }
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(params.file)).send(content);
});

app.get("/overlay/assets/:widgetId/:file", async (request, reply) => {
  const params = request.params as { widgetId: string; file: string };
  const query = request.query as { preview?: string };
  assertSafeAssetPath(params.widgetId, params.file);
  const filePath = path.join(
    await resolveWidgetDir(params.widgetId),
    params.file,
  );
  if (params.file.endsWith(".html")) {
    setNoCache(reply);
    const html = await fs.readFile(filePath, "utf8");
    let responseHtml = injectWidgetStylesheetRuntime(html);
    if (query.preview === "admin") {
      const metadataRaw = await fs.readFile(
        path.join(await resolveWidgetDir(params.widgetId), "widget.json"),
        "utf8",
      );
      responseHtml = injectWidgetPreviewRuntime(
        responseHtml,
        JSON.parse(metadataRaw) as Record<string, unknown>,
      );
    }
    reply.type("text/html").send(responseHtml);
    return;
  }
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(params.file)).send(content);
});

app.get("/dist.css", async (_request, reply) => {
  const content = await fs.readFile(path.join(widgetsDir, "dist.css"));
  reply.type("text/css").send(content);
});

app.get("/overlay/dist.css", async (_request, reply) => {
  const content = await fs.readFile(path.join(widgetsDir, "dist.css"));
  reply.type("text/css").send(content);
});

app.get("/images/*", async (request, reply) => {
  const params = request.params as { "*": string };
  const filePath = resolveSafeStaticPath(
    path.join(widgetsDir, "images"),
    params["*"] || "",
  );
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(filePath)).send(content);
});

app.get("/overlay/images/*", async (request, reply) => {
  const params = request.params as { "*": string };
  const filePath = resolveSafeStaticPath(
    path.join(widgetsDir, "images"),
    params["*"] || "",
  );
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(filePath)).send(content);
});

app.get("/icons/*", async (request, reply) => {
  const params = request.params as { "*": string };
  const filePath = resolveSafeStaticPath(
    path.join(widgetsDir, "icons"),
    params["*"] || "",
  );
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(filePath)).send(content);
});

app.get("/overlay/icons/*", async (request, reply) => {
  const params = request.params as { "*": string };
  const filePath = resolveSafeStaticPath(
    path.join(widgetsDir, "icons"),
    params["*"] || "",
  );
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(filePath)).send(content);
});

app.get("/catalogue.json", async (_request, reply) => {
  const entries = await fs.readdir(await widgetCatalogueDir(), {
    withFileTypes: true,
  });
  const catalogue = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const raw = await fs.readFile(
        path.join(await resolveWidgetDir(entry.name), "widget.json"),
        "utf8",
      );
      const metadata = JSON.parse(raw) as Record<string, unknown>;
      const errors = validateWidgetMetadata(metadata, entry.name);
      if (errors.length > 0) {
        app.log.warn(
          { widgetId: entry.name, errors },
          "skipping incompatible widget metadata",
        );
        continue;
      }
      catalogue.push(metadata);
    } catch {
      app.log.warn(
        { widgetId: entry.name },
        "skipping invalid widget metadata",
      );
    }
  }

  reply
    .type("application/json")
    .send(
      catalogue.sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
    );
});

app.get("/overlay/catalogue.json", async (_request, reply) => {
  const entries = await fs.readdir(await widgetCatalogueDir(), {
    withFileTypes: true,
  });
  const catalogue = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const raw = await fs.readFile(
        path.join(await resolveWidgetDir(entry.name), "widget.json"),
        "utf8",
      );
      const metadata = JSON.parse(raw) as Record<string, unknown>;
      const errors = validateWidgetMetadata(metadata, entry.name);
      if (errors.length > 0) {
        app.log.warn(
          { widgetId: entry.name, errors },
          "skipping incompatible widget metadata",
        );
        continue;
      }
      catalogue.push(metadata);
    } catch {
      app.log.warn(
        { widgetId: entry.name },
        "skipping invalid widget metadata",
      );
    }
  }

  reply
    .type("application/json")
    .send(
      catalogue.sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
    );
});

app.get("/validate", async (_request, reply) => {
  const entries = await fs.readdir(await widgetCatalogueDir(), {
    withFileTypes: true,
  });
  const widgets = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const widgetPath = await resolveWidgetDir(entry.name);
    const result = {
      id: entry.name,
      valid: true,
      errors: [] as string[],
    };

    try {
      const [metadataRaw] = await Promise.all([
        fs.readFile(path.join(widgetPath, "widget.json"), "utf8"),
        fs.access(path.join(widgetPath, "index.html")),
      ]);
      result.errors.push(
        ...validateWidgetMetadata(JSON.parse(metadataRaw), entry.name),
      );
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "widget validation failed",
      );
    }

    result.valid = result.errors.length === 0;
    widgets.push(result);
  }

  const invalid = widgets.filter((widget) => !widget.valid);
  reply.type("application/json").send({
    valid: invalid.length === 0,
    invalidCount: invalid.length,
    widgets: widgets.sort((left, right) => left.id.localeCompare(right.id)),
  });
});

app.get("/overlay/validate", async (_request, reply) => {
  const entries = await fs.readdir(await widgetCatalogueDir(), {
    withFileTypes: true,
  });
  const widgets = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const widgetPath = await resolveWidgetDir(entry.name);
    const result = {
      id: entry.name,
      valid: true,
      errors: [] as string[],
    };

    try {
      const [metadataRaw] = await Promise.all([
        fs.readFile(path.join(widgetPath, "widget.json"), "utf8"),
        fs.access(path.join(widgetPath, "index.html")),
      ]);
      result.errors.push(
        ...validateWidgetMetadata(JSON.parse(metadataRaw), entry.name),
      );
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "widget validation failed",
      );
    }

    result.valid = result.errors.length === 0;
    widgets.push(result);
  }

  const invalid = widgets.filter((widget) => !widget.valid);
  reply.type("application/json").send({
    valid: invalid.length === 0,
    invalidCount: invalid.length,
    widgets: widgets.sort((left, right) => left.id.localeCompare(right.id)),
  });
});

app.get("/*", async (_request, reply) => {
  setNoCache(reply);
  reply.type("text/html").send(htmlShell());
});

await app.listen({
  host: "0.0.0.0",
  port,
});

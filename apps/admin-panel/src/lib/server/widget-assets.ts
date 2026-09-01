import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const WIDGET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

export class WidgetAssetNotFoundError extends Error {}

export interface WidgetAsset {
  body: Uint8Array;
  contentType: string;
}

async function resolveWidgetsDirectory(): Promise<string> {
  const configured = process.env.SCARLINE_WIDGETS_DIRECTORY;
  const candidates = [
    configured ? path.resolve(configured) : null,
    path.resolve(process.cwd(), 'widgets'),
    path.resolve(process.cwd(), '../../widgets')
  ].filter((candidate): candidate is string => candidate !== null);

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(path.join(candidate, 'components'));
      return candidate;
    } catch {
      // Continue through the development and container locations.
    }
  }
  throw new WidgetAssetNotFoundError('The SCARline widget directory is unavailable.');
}

function safeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    normalized.length === 0
    || normalized.includes('\0')
    || normalized.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new WidgetAssetNotFoundError('Invalid widget asset path.');
  }
  return normalized;
}

export async function readWidgetAsset(relativePath: string): Promise<WidgetAsset> {
  const root = await resolveWidgetsDirectory();
  const normalized = safeRelativePath(relativePath);
  const target = path.resolve(root, normalized);
  const rootPrefix = `${root}${path.sep}`;
  if (!target.startsWith(rootPrefix)) {
    throw new WidgetAssetNotFoundError('Invalid widget asset path.');
  }

  try {
    const [resolvedRoot, resolvedTarget] = await Promise.all([
      realpath(root),
      realpath(target)
    ]);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new WidgetAssetNotFoundError('Invalid widget asset path.');
    }
    return {
      body: await readFile(resolvedTarget),
      contentType: CONTENT_TYPES[path.extname(resolvedTarget).toLowerCase()] ?? 'application/octet-stream'
    };
  } catch (cause) {
    if (cause instanceof WidgetAssetNotFoundError) throw cause;
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WidgetAssetNotFoundError('Widget asset not found.');
    }
    throw cause;
  }
}

export async function readWidgetComponentAsset(
  widgetId: string,
  assetPath: string,
  preview: boolean
): Promise<WidgetAsset> {
  if (!WIDGET_ID_PATTERN.test(widgetId)) {
    throw new WidgetAssetNotFoundError('Invalid widget identifier.');
  }

  const normalizedAsset = safeRelativePath(assetPath);
  const relativePath = `components/${widgetId}/${normalizedAsset}`;
  const asset = await readWidgetAsset(relativePath);
  if (!preview || asset.contentType !== 'text/html; charset=utf-8') return asset;

  const metadataAsset = await readWidgetAsset(`components/${widgetId}/widget.json`);
  const metadata = JSON.parse(Buffer.from(metadataAsset.body).toString('utf8')) as Record<string, unknown>;
  const html = Buffer.from(asset.body).toString('utf8');
  return {
    body: Buffer.from(injectPreviewRuntime(html, widgetId, metadata), 'utf8'),
    contentType: asset.contentType
  };
}

export function widgetAssetResponse(asset: WidgetAsset, preview = false): Response {
  return new Response(asset.body, {
    headers: {
      'cache-control': preview ? 'no-store' : 'public, max-age=60',
      'content-type': asset.contentType,
      'x-content-type-options': 'nosniff'
    }
  });
}

function injectPreviewRuntime(
  html: string,
  widgetId: string,
  metadata: Record<string, unknown>
): string {
  const defaults = bindingDefaults(metadata.bindings);
  const configuration = safeScriptJson({ widgetId, metadata, defaults });
  const bootstrap = `<script data-scarline-preview-runtime>
(() => {
  const configuration = ${configuration};
  const bindings = { ...configuration.defaults };
  const bindingListeners = new Map();
  const triggerListeners = new Set();
  const stateListeners = new Set();
  let state = "visible";
  const notifyBinding = (key, value) => {
    for (const listener of bindingListeners.get(key) ?? []) listener(value);
  };
  const subscribe = (collection, listener) => {
    collection.add(listener);
    return () => collection.delete(listener);
  };
  window.SCARline = Object.freeze({
    onBinding(key, listener) {
      const listeners = bindingListeners.get(key) ?? new Set();
      listeners.add(listener);
      bindingListeners.set(key, listeners);
      return () => listeners.delete(listener);
    },
    onTrigger(listener) { return subscribe(triggerListeners, listener); },
    onStateChange(listener) { return subscribe(stateListeners, listener); },
    getBinding(key) { return bindings[key]; },
    getState() { return state; },
    getMetadata() { return configuration.metadata; },
    send(type, payload = {}) {
      window.parent.postMessage({
        type: "scarline.widget.action",
        widgetId: configuration.widgetId,
        action: type,
        payload
      }, "*");
    },
    ready() {
      window.parent.postMessage({
        type: "scarline.widget.ready",
        widgetId: configuration.widgetId
      }, "*");
    }
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "scarline.preview.bindings" && event.data.values) {
      for (const [key, value] of Object.entries(event.data.values)) {
        bindings[key] = value;
        notifyBinding(key, value);
      }
    }
    if (event.data.type === "scarline.preview.trigger") {
      for (const listener of triggerListeners) listener(event.data.event ?? {});
    }
    if (event.data.type === "scarline.preview.state" && typeof event.data.state === "string") {
      state = event.data.state;
      for (const listener of stateListeners) listener(state);
    }
  });
})();
</script>`;

  return html.includes('</head>')
    ? html.replace('</head>', `${bootstrap}\n</head>`)
    : `${bootstrap}\n${html}`;
}

function bindingDefaults(bindings: unknown): Record<string, unknown> {
  if (Array.isArray(bindings)) {
    return Object.fromEntries(bindings.flatMap((binding) => {
      if (
        binding !== null
        && typeof binding === 'object'
        && typeof (binding as Record<string, unknown>).key === 'string'
        && 'default' in binding
      ) {
        return [[(binding as Record<string, unknown>).key, (binding as Record<string, unknown>).default]];
      }
      return [];
    }));
  }
  if (bindings === null || typeof bindings !== 'object') return {};
  return Object.fromEntries(Object.entries(bindings).flatMap(([key, binding]) => {
    if (binding !== null && typeof binding === 'object' && 'default' in binding) {
      return [[key, (binding as Record<string, unknown>).default]];
    }
    return [];
  }));
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

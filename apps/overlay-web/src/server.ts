import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';

const port = Number(process.env.PORT ?? 4000);
const widgetsDir = path.resolve(process.cwd(), '../../widgets');
const publicDir = path.resolve(process.cwd(), 'public');
const coreApiOrigin = process.env.CORE_API_ORIGIN ?? '';
const publicWsUrl = process.env.PUBLIC_WS_URL ?? '';

const app = Fastify({
  logger: true
});

const validWidgetCategories = new Set(['driving', 'health', 'navigation', 'study', 'general', 'communication']);
const validBindingTypes = new Set(['number', 'string', 'boolean', 'object', 'array']);
const validTriggerActions = new Set(['show', 'hide', 'highlight', 'reset', 'toggle', 'notify', 'update']);

function assertSafeAssetPath(widgetId: string, file: string): void {
  if (!/^[a-z0-9-]+$/.test(widgetId) || !/^[a-zA-Z0-9._-]+$/.test(file)) {
    throw new Error('Invalid overlay asset path');
  }
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  return 'text/html';
}

function validateWidgetMetadata(metadata: Record<string, unknown>, widgetId: string): string[] {
  const errors: string[] = [];
  if (metadata.id !== widgetId) errors.push('metadata id must match widget directory');
  if (typeof metadata.name !== 'string' || !metadata.name) errors.push('name is required');
  if (typeof metadata.description !== 'string' || !metadata.description) errors.push('description is required');
  if (metadata.entry !== 'index.html') errors.push('entry must be index.html');
  if (typeof metadata.category !== 'string' || !validWidgetCategories.has(metadata.category)) {
    errors.push('category must be a supported widget category');
  }
  if (!Array.isArray(metadata.bindings)) errors.push('bindings must be an array');
  if (!Array.isArray(metadata.triggers)) errors.push('triggers must be an array');
  if (Array.isArray(metadata.bindings)) {
    const bindingKeys = new Set<string>();
    for (const [index, binding] of metadata.bindings.entries()) {
      if (typeof binding !== 'object' || binding === null) {
        errors.push(`bindings.${index} must be an object`);
        continue;
      }

      const entry = binding as Record<string, unknown>;
      if (typeof entry.key !== 'string' || !/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(entry.key)) {
        errors.push(`bindings.${index}.key must be a dotted lower-camel path`);
      } else if (bindingKeys.has(entry.key)) {
        errors.push(`bindings.${index}.key must be unique`);
      } else {
        bindingKeys.add(entry.key);
      }

      if (typeof entry.type !== 'string' || !validBindingTypes.has(entry.type)) {
        errors.push(`bindings.${index}.type must be supported`);
      }
    }
  }
  if (Array.isArray(metadata.triggers)) {
    const triggerActions = new Set<string>();
    for (const [index, trigger] of metadata.triggers.entries()) {
      if (typeof trigger !== 'object' || trigger === null) {
        errors.push(`triggers.${index} must be an object`);
        continue;
      }

      const entry = trigger as Record<string, unknown>;
      if (typeof entry.action !== 'string' || !validTriggerActions.has(entry.action)) {
        errors.push(`triggers.${index}.action must be supported`);
      } else if (triggerActions.has(entry.action)) {
        errors.push(`triggers.${index}.action must be unique`);
      } else {
        triggerActions.add(entry.action);
      }

      if (typeof entry.description !== 'string' || !entry.description) {
        errors.push(`triggers.${index}.description is required`);
      }
    }
  }
  if (typeof metadata.ui !== 'object' || metadata.ui === null) {
    errors.push('ui sizing metadata is required');
  } else {
    const ui = metadata.ui as Record<string, unknown>;
    for (const key of ['minWidth', 'minHeight', 'preferredWidth', 'preferredHeight']) {
      if (typeof ui[key] !== 'number' || Number(ui[key]) <= 0) {
        errors.push(`ui.${key} must be a positive number`);
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
          background: #000;
          color: #fff;
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
      </script>
      <script type="module" src="./app.js"></script>
    </body>
  </html>`;
}

app.get('/health', async () => ({
  status: 'healthy',
  mode: process.env.WIDGET_TEST_MODE === 'true' ? 'widget-test' : 'runtime'
}));

app.get('/app.js', async (_request, reply) => {
  const file = await fs.readFile(path.join(publicDir, 'app.js'), 'utf8');
  reply.type('text/javascript').send(file);
});

app.get('/assets/:widgetId/:file', async (request, reply) => {
  const params = request.params as { widgetId: string; file: string };
  assertSafeAssetPath(params.widgetId, params.file);
  const filePath = path.join(widgetsDir, params.widgetId, params.file);
  const content = await fs.readFile(filePath);
  reply.type(contentTypeFor(params.file)).send(content);
});

app.get('/catalogue.json', async (_request, reply) => {
  const entries = await fs.readdir(widgetsDir, { withFileTypes: true });
  const catalogue = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const raw = await fs.readFile(path.join(widgetsDir, entry.name, 'widget.json'), 'utf8');
      const metadata = JSON.parse(raw) as Record<string, unknown>;
      const errors = validateWidgetMetadata(metadata, entry.name);
      if (errors.length > 0) {
        app.log.warn({ widgetId: entry.name, errors }, 'skipping incompatible widget metadata');
        continue;
      }
      catalogue.push(metadata);
    } catch {
      app.log.warn({ widgetId: entry.name }, 'skipping invalid widget metadata');
    }
  }

  reply.type('application/json').send(catalogue.sort((left, right) => String(left.id).localeCompare(String(right.id))));
});

app.get('/validate', async (_request, reply) => {
  const entries = await fs.readdir(widgetsDir, { withFileTypes: true });
  const widgets = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const widgetPath = path.join(widgetsDir, entry.name);
    const result = {
      id: entry.name,
      valid: true,
      errors: [] as string[]
    };

    try {
      const [metadataRaw] = await Promise.all([
        fs.readFile(path.join(widgetPath, 'widget.json'), 'utf8'),
        fs.access(path.join(widgetPath, 'index.html'))
      ]);
      result.errors.push(...validateWidgetMetadata(JSON.parse(metadataRaw), entry.name));
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'widget validation failed');
    }

    result.valid = result.errors.length === 0;
    widgets.push(result);
  }

  const invalid = widgets.filter((widget) => !widget.valid);
  reply.type('application/json').send({
    valid: invalid.length === 0,
    invalidCount: invalid.length,
    widgets: widgets.sort((left, right) => left.id.localeCompare(right.id))
  });
});

app.get('/*', async (_request, reply) => {
  reply.type('text/html').send(htmlShell());
});

await app.listen({
  host: '0.0.0.0',
  port
});

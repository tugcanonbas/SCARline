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
      <script type="module" src="/app.js"></script>
    </body>
  </html>`;
}

app.get('/health', async () => ({
  status: 'healthy'
}));

app.get('/app.js', async (_request, reply) => {
  const file = await fs.readFile(path.join(publicDir, 'app.js'), 'utf8');
  reply.type('text/javascript').send(file);
});

app.get('/assets/:widgetId/:file', async (request, reply) => {
  const params = request.params as { widgetId: string; file: string };
  const filePath = path.join(widgetsDir, params.widgetId, params.file);
  const content = await fs.readFile(filePath);
  if (params.file.endsWith('.json')) {
    reply.type('application/json');
  } else if (params.file.endsWith('.png')) {
    reply.type('image/png');
  } else {
    reply.type('text/html');
  }
  reply.send(content);
});

app.get('/*', async (_request, reply) => {
  reply.type('text/html').send(htmlShell());
});

await app.listen({
  host: '0.0.0.0',
  port
});

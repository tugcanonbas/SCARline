import Fastify from 'fastify';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { ComponentRegistry } from './lib/component-status.js';
import { loadConfig } from './lib/config.js';
import { handleCoreCommand, publishPendingOutbox } from './lib/commands.js';
import { createPool } from './lib/db.js';
import { handleEvent } from './lib/events.js';
import { globalErrorHandler } from './lib/errors.js';
import { registerApi } from './lib/api.js';
import { RabbitManager } from './lib/rabbit.js';
import { WebSocketHub } from './lib/websocket-hub.js';
import { RABBITMQ_QUEUES } from '@scarline/contracts';

const config = loadConfig();
const pool = createPool(config);
const rabbit = new RabbitManager(config.AMQP_URL);
const wsHub = new WebSocketHub();
const components = new ComponentRegistry();
const app = Fastify({
  logger: true
});

await app.register(websocket as never);

// Global Rate Limiting: 100 requests per minute per IP
await app.register(rateLimit as never, {
  max: 100,
  timeWindow: '1 minute'
});

// Centralized error handler — normalizes Zod, JWT, PostgreSQL, and unhandled errors
app.setErrorHandler(globalErrorHandler);

await rabbit.connect();
await publishPendingOutbox(pool, rabbit);
setInterval(() => {
  void publishPendingOutbox(pool, rabbit).catch((error) => {
    app.log.warn({ err: error }, 'failed to publish pending outbox events');
  });
}, 30_000).unref();

components.upsert({
  componentId: 'core-api',
  componentName: 'Core API',
  status: 'running',
  checkedAt: new Date().toISOString()
});

await registerApi(app, {
  config,
  pool,
  rabbit,
  wsHub,
  components
});

await rabbit.consume(RABBITMQ_QUEUES.coreApiCommands, async (message) => {
  await handleCoreCommand(message, {
    logger: app.log,
    pool,
    rabbit,
    wsHub
  });
});

await rabbit.consume(RABBITMQ_QUEUES.coreApiEvents, async (message) => {
  await handleEvent(message, {
    logger: app.log,
    pool,
    rabbit,
    wsHub,
    components
  });
});

await app.listen({
  host: '0.0.0.0',
  port: config.PORT
});

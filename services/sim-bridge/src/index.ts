import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { RABBITMQ_QUEUES } from '@scarline/contracts';
import { AdapterRegistry } from './lib/adapter-registry.js';
import { loadConfig } from './lib/config.js';
import { RabbitManager } from './lib/rabbit.js';

const config = loadConfig();
const rabbit = new RabbitManager(config.AMQP_URL);
const adapters = new AdapterRegistry();
const app = Fastify({
  logger: true
});

await app.register(websocket);
await rabbit.connect();

const adapterEnvelopeSchema = z.object({
  version: z.string().default('1.0'),
  id: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional().nullable(),
  timestamp: z.string().datetime().optional(),
  type: z.enum(['register', 'event', 'response', 'heartbeat']),
  source: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({})
});

app.get('/health', async () => ({
  status: 'healthy',
  adapters: adapters.list()
}));

app.get('/adapter', { websocket: true }, (socket) => {
  let assignedId: string | null = null;

  socket.on('message', async (raw: Buffer) => {
    try {
      const message = adapterEnvelopeSchema.parse(JSON.parse(raw.toString()));
      if (message.type === 'register') {
        assignedId = `adapter-${randomUUID()}`;
        adapters.register({
          assignedId,
          adapterId: String(message.payload.adapterId ?? message.payload.name ?? assignedId),
          simulatorType: String(message.payload.simulatorType ?? 'unknown'),
          simulatorVersion: String(message.payload.simulatorVersion ?? 'unknown'),
          capabilities: z.array(z.string()).parse(message.payload.capabilities ?? []),
          status: String(message.payload.status ?? 'ready'),
          socket: socket as never,
          lastHeartbeatAt: new Date().toISOString(),
          activeSessionId: null
        });

        socket.send(JSON.stringify({
          type: 'response',
          correlationId: message.id ?? null,
          payload: {
            accepted: true,
            assignedId,
            sessionId: null
          }
        }));
        return;
      }

      if (!assignedId) {
        socket.close();
        return;
      }

      if (message.type === 'heartbeat') {
        adapters.updateHeartbeat(assignedId);
        return;
      }

      if (message.type === 'event') {
        const routingKey = String(message.payload.routingKey);
        await rabbit.publish({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          routingKey,
          producer: 'sim-bridge',
          type: 'event',
          payload: (message.payload.data ?? {}) as Record<string, unknown>,
          metadata: {
            studyId: typeof message.payload.studyId === 'string' ? message.payload.studyId : null,
            runId: typeof message.payload.runId === 'string' ? message.payload.runId : null,
            correlationId: null
          }
        });
        return;
      }

      if (message.type === 'response' && message.payload.sessionId) {
        adapters.bindSession(assignedId, String(message.payload.sessionId));
      }
    } catch (error) {
      app.log.error({ err: error }, 'failed to handle adapter message');
      socket.send(JSON.stringify({
        type: 'response',
        payload: {
          accepted: false,
          error: 'invalid_message'
        }
      }));
    }
  });

  socket.on('close', () => {
    if (assignedId) {
      adapters.remove(assignedId);
    }
  });
});

await rabbit.consume(RABBITMQ_QUEUES.simBridgeCommands, async (message) => {
  const adapter = adapters.resolveForSession(message.metadata.runId);
  if (!adapter) {
    app.log.warn({ routingKey: message.routingKey }, 'no adapter connected for simulator command');
    return;
  }

  const action = message.routingKey.replace('commands.simulator.', '');
  if (action === 'unbind-session' && message.metadata.runId) {
    adapters.clearSession(message.metadata.runId);
  }

  adapter.socket.send(JSON.stringify({
    version: '1.0',
    id: randomUUID(),
    correlationId: message.metadata.correlationId,
    timestamp: new Date().toISOString(),
    type: 'command',
    source: 'sim-bridge',
    payload: {
      action,
      sessionId: message.metadata.runId,
      studyId: message.metadata.studyId,
      ...message.payload
    }
  }));
});

await app.listen({
  host: '0.0.0.0',
  port: config.PORT
});

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import '@fastify/websocket';
import { z } from 'zod';
import {
  makeEventRoutingKey,
  RABBITMQ_QUEUES,
  SIM_BRIDGE_WEBSOCKET_PATHS,
  type ComponentId,
  type RabbitMessage
} from '@scarline/contracts';
import { AdapterRegistry } from './lib/adapter-registry.js';
import { loadConfig } from './lib/config.js';
import { RabbitManager } from './lib/rabbit.js';

const config = loadConfig();
const rabbit = new RabbitManager(config.AMQP_URL);
const adapters = new AdapterRegistry();
const app = Fastify({
  logger: true
});
const ADAPTER_COMMAND_TIMEOUT_MS = Number(process.env.SIM_BRIDGE_ADAPTER_COMMAND_TIMEOUT_MS ?? 15_000);
const ADAPTER_STALE_MS = Number(process.env.SIM_BRIDGE_ADAPTER_STALE_MS ?? 30_000);
const ADAPTER_SWEEP_MS = Math.min(10_000, Math.max(1_000, Math.floor(ADAPTER_STALE_MS / 2)));

await app.register(websocket as never);
await rabbit.connect();

interface PendingAdapterCommand {
  action: string;
  studyId: string | null;
  runId: string | null;
  originalCorrelationId: string | null;
  adapterAssignedId: string;
  adapterId: string;
  simulatorType: string;
  timeout: NodeJS.Timeout;
}

interface AdapterSocket {
  on: (event: 'message' | 'close', handler: (...args: any[]) => void) => void;
  send: (message: string) => void;
  close: () => void;
}

const pendingAdapterCommands = new Map<string, PendingAdapterCommand>();

function componentIdForAdapter(simulatorType: string): ComponentId {
  if (simulatorType === 'carla') {
    return 'carla-client';
  }

  if (simulatorType === 'mock') {
    return 'mock-simulator';
  }

  return 'sim-bridge';
}

async function publishComponentStatus(componentId: ComponentId, componentName: string, status: string, message?: string) {
  const payload: RabbitMessage = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey: makeEventRoutingKey('system', 'global', 'system', 'component.status'),
    producer: 'sim-bridge',
    type: 'event',
    payload: {
      componentId,
      componentName,
      status,
      message,
      checkedAt: new Date().toISOString()
    },
    metadata: {
      studyId: null,
      runId: null,
      correlationId: null
    }
  };

  await rabbit.publish(payload);
}

function simulatorEventTypeForAction(action: string, succeeded: boolean): string {
  if (!succeeded) {
    return 'simulator.command.failed';
  }

  switch (action) {
    case 'bind-session':
      return 'simulator.bound';
    case 'pause-session':
      return 'simulator.paused';
    case 'resume-session':
      return 'simulator.resumed';
    case 'unbind-session':
      return 'simulator.unbound';
    default:
      return 'simulator.command.completed';
  }
}

async function publishSimulatorCommandEvent(
  pending: PendingAdapterCommand,
  payload: Record<string, unknown>,
  succeeded: boolean
) {
  await rabbit.publish({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey: makeEventRoutingKey(
      pending.studyId ?? 'system',
      pending.runId ?? 'global',
      'system',
      simulatorEventTypeForAction(pending.action, succeeded)
    ),
    producer: 'sim-bridge',
    type: 'event',
    payload: {
      action: pending.action,
      studyId: pending.studyId,
      sessionId: pending.runId,
      adapterAssignedId: pending.adapterAssignedId,
      adapterId: pending.adapterId,
      simulatorType: pending.simulatorType,
      ...payload
    },
    metadata: {
      studyId: pending.studyId,
      runId: pending.runId,
      correlationId: pending.originalCorrelationId
    }
  });
}

async function publishCommandFailure(
  message: RabbitMessage,
  action: string,
  code: 'CONFLICT' | 'COMMAND_FAILED',
  failureMessage: string
) {
  await rabbit.publish({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey: makeEventRoutingKey(
      message.metadata.studyId ?? 'system',
      message.metadata.runId ?? 'global',
      'system',
      'simulator.command.failed'
    ),
    producer: 'sim-bridge',
    type: 'event',
    payload: {
      action,
      studyId: message.metadata.studyId,
      sessionId: message.metadata.runId,
      code,
      message: failureMessage
    },
    metadata: {
      studyId: message.metadata.studyId,
      runId: message.metadata.runId,
      correlationId: message.metadata.correlationId
    }
  });
}

async function failPendingAdapterCommand(
  forwardedId: string,
  pending: PendingAdapterCommand,
  code: string,
  failureMessage: string
) {
  clearTimeout(pending.timeout);
  pendingAdapterCommands.delete(forwardedId);

  if (pending.runId && (pending.action === 'bind-session' || pending.action === 'unbind-session')) {
    adapters.clearSession(pending.runId);
  }

  await publishSimulatorCommandEvent(
    pending,
    {
      accepted: false,
      code,
      message: failureMessage
    },
    false
  );
}

async function failPendingCommandsForAdapter(adapterAssignedId: string, code: string, failureMessage: string) {
  const pendingForAdapter = Array.from(pendingAdapterCommands.entries())
    .filter(([, pending]) => pending.adapterAssignedId === adapterAssignedId);

  for (const [forwardedId, pending] of pendingForAdapter) {
    await failPendingAdapterCommand(forwardedId, pending, code, failureMessage);
  }
}

await publishComponentStatus('sim-bridge', 'Sim Bridge', 'running', 'Simulator bridge is accepting adapter registrations');

const heartbeatSweep = setInterval(() => {
  const staleAdapters = adapters.evictStale(ADAPTER_STALE_MS);
  for (const adapter of staleAdapters) {
    app.log.warn({ adapterAssignedId: adapter.assignedId, simulatorType: adapter.simulatorType }, 'evicted stale simulator adapter');
    void failPendingCommandsForAdapter(
      adapter.assignedId,
      'ADAPTER_DISCONNECTED',
      'Simulator adapter heartbeat expired before command acknowledgement'
    ).catch((error) => app.log.error({ err: error }, 'failed to reject pending adapter commands'));
    void publishComponentStatus(
      componentIdForAdapter(adapter.simulatorType),
      `${adapter.simulatorType} Adapter`,
      'disconnected',
      'Adapter heartbeat expired'
    ).catch((error) => app.log.error({ err: error }, 'failed to publish stale adapter component status'));
  }
}, ADAPTER_SWEEP_MS);
heartbeatSweep.unref();

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

function handleAdapterSocket(connection: unknown) {
  const socket = (connection as { socket: AdapterSocket }).socket;
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
        await publishComponentStatus(
          componentIdForAdapter(String(message.payload.simulatorType ?? 'unknown')),
          `${String(message.payload.simulatorType ?? 'Simulator')} Adapter`,
          'running',
          'Adapter registered with sim-bridge'
        );
        return;
      }

      if (!assignedId) {
        socket.close();
        return;
      }

      if (message.type === 'heartbeat') {
        adapters.updateHeartbeat(assignedId);
        // carla connection - 2026-08-23
        if (typeof message.payload.status === 'string') {
          adapters.updateStatus(assignedId, message.payload.status);
        }
        // end carla connection
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

      if (message.type === 'response') {
        const pendingKey = typeof message.correlationId === 'string' ? message.correlationId : null;
        if (!pendingKey) {
          return;
        }

        const pending = pendingAdapterCommands.get(pendingKey);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        pendingAdapterCommands.delete(pendingKey);
        const succeeded = message.payload.accepted !== false && message.payload.success !== false;

        if (!succeeded && pending.runId) {
          adapters.clearSession(pending.runId);
        } else if (pending.action === 'bind-session' && pending.runId) {
          adapters.bindSession(assignedId, pending.runId);
        } else if (pending.action === 'unbind-session' && pending.runId) {
          adapters.clearSession(pending.runId);
        } else if (pending.runId && message.payload.activeSessionId === null) {
          adapters.clearSession(pending.runId);
        }

        await publishSimulatorCommandEvent(pending, message.payload, succeeded);
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
      const adapter = adapters.list().find((entry) => entry.assignedId === assignedId);
      adapters.remove(assignedId);
      if (adapter) {
        void failPendingCommandsForAdapter(
          adapter.assignedId,
          'ADAPTER_DISCONNECTED',
          'Simulator adapter disconnected before command acknowledgement'
        ).catch((error) => app.log.error({ err: error }, 'failed to reject pending adapter commands'));
        void publishComponentStatus(
          componentIdForAdapter(adapter.simulatorType),
          `${adapter.simulatorType} Adapter`,
          'disconnected',
          'Adapter disconnected from sim-bridge'
        ).catch((error) => app.log.error({ err: error }, 'failed to publish adapter disconnect status'));
      }
    }
  });
}

app.get(SIM_BRIDGE_WEBSOCKET_PATHS.adapter, { websocket: true } as never, handleAdapterSocket as never);
app.get(SIM_BRIDGE_WEBSOCKET_PATHS.bridgeCompatibility, { websocket: true } as never, handleAdapterSocket as never);

await rabbit.consume(RABBITMQ_QUEUES.simBridgeCommands, async (message) => {
  const action = message.routingKey.replace('commands.simulator.', '');
  const runId = message.metadata.runId;
  const preferredSimulatorType = typeof message.payload.simulatorType === 'string'
    ? message.payload.simulatorType
    : null;
  const adapter = action === 'bind-session'
    ? adapters.resolveAvailable(preferredSimulatorType)
    : runId
      ? adapters.resolveForSession(runId)
      : null;

  if (!adapter) {
    app.log.warn({ routingKey: message.routingKey }, 'no adapter connected for simulator command');
    await publishCommandFailure(message, action, 'CONFLICT', 'No simulator adapter is available for this session');
    return;
  }

  if (action === 'bind-session' && runId) {
    adapters.bindSession(adapter.assignedId, runId);
  }

  const forwardedId = randomUUID();
  const timeout = setTimeout(() => {
    const pending = pendingAdapterCommands.get(forwardedId);
    if (!pending) {
      return;
    }

    void failPendingAdapterCommand(
      forwardedId,
      pending,
      'TIMEOUT',
      `Simulator adapter did not acknowledge ${action} within ${ADAPTER_COMMAND_TIMEOUT_MS}ms`
    ).catch((error) => app.log.error({ err: error }, 'failed to publish adapter command timeout'));
  }, ADAPTER_COMMAND_TIMEOUT_MS);
  timeout.unref();

  const pending: PendingAdapterCommand = {
    action,
    studyId: message.metadata.studyId,
    runId,
    originalCorrelationId: message.metadata.correlationId,
    adapterAssignedId: adapter.assignedId,
    adapterId: adapter.adapterId,
    simulatorType: adapter.simulatorType,
    timeout
  };
  pendingAdapterCommands.set(forwardedId, pending);

  try {
    adapter.socket.send(JSON.stringify({
      version: '1.0',
      id: forwardedId,
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
  } catch (error) {
    clearTimeout(pending.timeout);
    pendingAdapterCommands.delete(forwardedId);
    if (action === 'bind-session' && runId) {
      adapters.clearSession(runId);
    }

    await publishCommandFailure(
      message,
      action,
      'COMMAND_FAILED',
      error instanceof Error ? error.message : 'Failed to forward simulator command to adapter'
    );
  }
});

await app.listen({
  host: '0.0.0.0',
  port: config.PORT
});

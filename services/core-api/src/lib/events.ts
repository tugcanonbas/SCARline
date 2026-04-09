import { randomUUID } from 'node:crypto';
import { makeCommandRoutingKey } from '@scarline/contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { RabbitManager } from './rabbit.js';
import type { WebSocketHub } from './websocket-hub.js';
import type { ComponentRegistry } from './component-status.js';
import type { ComponentId, HealthStatus, RabbitMessage } from '@scarline/contracts';

interface EventContext {
  logger: FastifyBaseLogger;
  pool: Pool;
  rabbit: RabbitManager;
  wsHub: WebSocketHub;
  components: ComponentRegistry;
}

export async function handleEvent(message: RabbitMessage, context: EventContext): Promise<void> {
  const { pool, rabbit, wsHub, components } = context;
  const [prefix, studyId, runId, modality, eventType] = message.routingKey.split('.');

  if (prefix !== 'events') {
    return;
  }

  if (studyId !== 'system' && runId !== 'global') {
    await pool.query(
      `INSERT INTO session_events (session_id, study_id, timestamp, event_type, modality, source, routing_key, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        runId,
        studyId,
        message.timestamp,
        `${modality}.${eventType}`,
        modality,
        message.producer,
        message.routingKey,
        JSON.stringify(message.payload)
      ]
    );
  }

  if (message.routingKey.includes('.session.')) {
    wsHub.broadcast('session.events', message.payload);
  } else if (message.routingKey.includes('.vehicle.') || message.routingKey.includes('.sensor.') || message.routingKey.includes('.health.')) {
    wsHub.broadcast('session.telemetry', {
      routingKey: message.routingKey,
      ...message.payload
    });
    wsHub.broadcast('widget.updates', {
      routingKey: message.routingKey,
      payload: message.payload
    });
  } else if (message.routingKey.includes('.widget.')) {
    wsHub.broadcast('widget.updates', message.payload);
  } else if (message.routingKey === 'events.system.global.system.component.status') {
    components.upsert({
      componentId: String(message.payload.componentId) as ComponentId,
      componentName: String(message.payload.componentName),
      status: String(message.payload.status) as HealthStatus,
      message: message.payload.message ? String(message.payload.message) : undefined,
      checkedAt: String(message.payload.checkedAt),
      metadata: (message.payload.metadata ?? {}) as Record<string, unknown>
    });
    wsHub.broadcast('system.health', message.payload);
  } else if (message.routingKey === 'events.system.global.system.sensor.status') {
    wsHub.broadcast('sensor.status', message.payload);
  }

  if (message.routingKey.endsWith('.driving.io.steering')) {
    await rabbit.publish('scarline.commands', makeCommandRoutingKey('simulator', 'apply-control'), {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      routingKey: makeCommandRoutingKey('simulator', 'apply-control'),
      producer: 'core-api',
      type: 'command',
      payload: message.payload,
      metadata: {
        studyId: studyId === 'system' ? null : studyId,
        runId: runId === 'global' ? null : runId,
        correlationId: null
      }
    });
  }
}

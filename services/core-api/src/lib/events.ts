import { randomUUID } from 'node:crypto';
import { makeCommandRoutingKey, makeEventRoutingKey, RABBITMQ_EXCHANGES } from '@scarline/contracts';
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

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in value) {
      return (value as Record<string, unknown>)[key];
    }

    return undefined;
  }, source);
}

function toComparable(value: unknown): number | string | boolean | null {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function operandValue(payload: Record<string, unknown>, raw: string): number | string | boolean | null {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  const direct = getPath(payload, trimmed);
  if (typeof direct !== 'undefined') {
    return toComparable(direct);
  }

  const vehicle = payload.vehicle;
  if (vehicle && typeof vehicle === 'object') {
    return toComparable(getPath(vehicle as Record<string, unknown>, trimmed));
  }

  return null;
}

function evaluateRuleCondition(payload: Record<string, unknown>, expression: string): boolean {
  const match = expression.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!match) {
    return false;
  }

  const left = operandValue(payload, match[1]);
  const right = operandValue(payload, match[3]);
  if (left === null || right === null) {
    return false;
  }

  switch (match[2]) {
    case '>': return Number(left) > Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<': return Number(left) < Number(right);
    case '<=': return Number(left) <= Number(right);
    case '==': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}

async function evaluateTriggerRules(message: RabbitMessage, context: EventContext, studyId: string, runId: string): Promise<void> {
  const session = await context.pool.query<{ condition_id: string | null }>(
    `SELECT condition_id FROM sessions WHERE id = $1 AND study_id = $2 AND status IN ('running', 'paused')`,
    [runId, studyId]
  );
  if (session.rowCount !== 1) {
    return;
  }

  const rules = await context.pool.query<{
    id: string;
    name: string;
    widget_id: string;
    instance_id: string | null;
    rule_condition: string;
    action: string;
    binding_overrides: Record<string, unknown>;
    cooldown_ms: number;
    last_triggered_at: Date | null;
  }>(
    `SELECT id, name, widget_id, instance_id, rule_condition, action, binding_overrides, cooldown_ms, last_triggered_at
     FROM study_trigger_rules
     WHERE study_id = $1
       AND enabled = TRUE
       AND (condition_id IS NULL OR condition_id = $2)
     ORDER BY priority ASC, created_at ASC`,
    [studyId, session.rows[0].condition_id]
  );

  for (const rule of rules.rows) {
    if (rule.last_triggered_at && Date.now() - rule.last_triggered_at.getTime() < rule.cooldown_ms) {
      continue;
    }
    if (!evaluateRuleCondition(message.payload, rule.rule_condition)) {
      continue;
    }

    await context.pool.query(`UPDATE study_trigger_rules SET last_triggered_at = NOW(), updated_at = NOW() WHERE id = $1`, [rule.id]);
    const routingKey = makeEventRoutingKey(studyId, runId, 'study', 'widget.triggered');
    await context.rabbit.publish(RABBITMQ_EXCHANGES.events, routingKey, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      routingKey,
      producer: 'core-api',
      type: 'event',
      payload: {
        ruleId: rule.id,
        ruleName: rule.name,
        instanceId: rule.instance_id,
        widgetId: rule.widget_id,
        triggerType: 'automatic',
        source: 'rule-engine',
        action: rule.action,
        bindingValues: rule.binding_overrides,
        payload: {
          matchedCondition: rule.rule_condition
        }
      },
      metadata: {
        studyId,
        runId,
        correlationId: message.metadata.correlationId
      }
    });
  }
}

export async function handleEvent(message: RabbitMessage, context: EventContext): Promise<void> {
  const { pool, rabbit, wsHub, components } = context;
  const [prefix, studyId, runId, modality, ...eventParts] = message.routingKey.split('.');
  const eventType = eventParts.join('.');

  if (prefix !== 'events') {
    return;
  }

  if (modality === 'system' && eventType === 'simulator.command.failed') {
    const code = typeof message.payload.code === 'string' ? message.payload.code : 'COMMAND_FAILED';
    const failureMessage = typeof message.payload.message === 'string'
      ? message.payload.message
      : 'Simulator command failed';
    rabbit.rejectPending(message.metadata.correlationId, new Error(`${code}:${failureMessage}`));
  } else if (
    modality === 'system'
    && ['simulator.bound', 'simulator.paused', 'simulator.resumed', 'simulator.unbound', 'simulator.command.completed'].includes(eventType)
  ) {
    rabbit.resolvePending(message.metadata.correlationId, {
      ok: true,
      ...message.payload
    });
  }

  if (studyId !== 'system' && runId !== 'global') {
    await pool.query(
      `INSERT INTO session_events (message_id, session_id, study_id, timestamp, event_type, modality, source, routing_key, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        message.id,
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

    if (message.routingKey.includes('.vehicle.') || message.routingKey.includes('.sensor.')) {
      await evaluateTriggerRules(message, context, studyId, runId);
    }
  }

  if (message.routingKey === 'events.system.global.system.component.status') {
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
    const driverId = String(message.payload.driverId);
    const sensorType = String(message.payload.sensorType);
    const connected = Boolean(message.payload.connected);
    const status = connected ? 'running' : 'disconnected';
    const updated = await pool.query(
      `UPDATE devices
       SET status = $3,
           status_message = $4,
           last_seen_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
           updated_at = NOW()
       WHERE name = $1 AND type = $2`,
      [
        driverId,
        sensorType,
        status,
        message.payload.message ? String(message.payload.message) : null,
        JSON.stringify(message.payload)
      ]
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO devices (name, type, status, status_message, metadata, last_seen_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
        [
          driverId,
          sensorType,
          status,
          message.payload.message ? String(message.payload.message) : null,
          JSON.stringify(message.payload)
        ]
      );
    }
    wsHub.broadcast('sensor.status', message.payload);
  } else if (message.routingKey === 'events.system.global.system.export.progress' || (modality === 'system' && eventType === 'export.progress')) {
    wsHub.broadcast('export.progress', {
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      ...message.payload
    });
  } else if (modality === 'sensor' && eventType === 'io.driver_status') {
    wsHub.broadcast('sensor.status', message.payload);
    wsHub.broadcast('widget.updates', {
      routingKey: message.routingKey,
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      payload: message.payload
    });
  } else if (message.routingKey.includes('.session.')) {
    wsHub.broadcast('session.events', {
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      ...message.payload
    });
  } else if (
    message.routingKey.includes('.vehicle.')
    || message.routingKey.includes('.sensor.')
    || message.routingKey.includes('.world.')
    || message.routingKey.includes('.health.')
    || message.routingKey.includes('.io.')
  ) {
    wsHub.broadcast('session.telemetry', {
      routingKey: message.routingKey,
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      modality,
      eventType,
      payload: message.payload
    });
    wsHub.broadcast('widget.updates', {
      routingKey: message.routingKey,
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      modality,
      eventType,
      payload: message.payload
    });
  } else if (message.routingKey.includes('.widget.')) {
    wsHub.broadcast('widget.updates', {
      studyId: studyId === 'system' ? null : studyId,
      sessionId: runId === 'global' ? null : runId,
      ...message.payload
    });
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

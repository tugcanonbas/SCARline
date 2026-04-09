import { randomUUID } from 'node:crypto';
import { makeCommandRoutingKey, makeEventRoutingKey, RABBITMQ_EXCHANGES, type RabbitMessage } from '@scarline/contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { RabbitManager } from './rabbit.js';
import type { WebSocketHub } from './websocket-hub.js';

interface CommandContext {
  logger: FastifyBaseLogger;
  pool: Pool;
  rabbit: RabbitManager;
  wsHub: WebSocketHub;
}

async function publishEvent(
  rabbit: RabbitManager,
  routingKey: string,
  payload: Record<string, unknown>,
  metadata: { studyId?: string; runId?: string } = {}
): Promise<void> {
  const message: RabbitMessage = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey,
    producer: 'core-api',
    type: 'event',
    payload,
    metadata: {
      studyId: metadata.studyId ?? null,
      runId: metadata.runId ?? null,
      correlationId: null
    }
  };

  await rabbit.publish(RABBITMQ_EXCHANGES.events, routingKey, message);
}

export async function handleCoreCommand(message: RabbitMessage, context: CommandContext): Promise<void> {
  const { logger, pool, rabbit } = context;
  const correlationId = message.metadata.correlationId;

  try {
    switch (message.routingKey) {
      case 'commands.session.start': {
        const session = await pool.query<{
          id: string;
          study_id: string;
          condition_id: string | null;
          status: string;
        }>(
          `SELECT id, study_id, condition_id, status
           FROM sessions
           WHERE id = $1`,
          [message.payload.sessionId]
        );

        if (session.rowCount !== 1) {
          throw new Error('Session not found');
        }
        if (session.rows[0].status !== 'created') {
          throw new Error('Session must be in created state');
        }

        const carlaConfig = await pool.query<{ map: string; weather_preset: string | null; weather_custom: Record<string, unknown>; ego_vehicle_blueprint: string; sensors: unknown[]; traffic_config: Record<string, unknown>; recording_config: Record<string, unknown> }>(
          `SELECT map, weather_preset, weather_custom, ego_vehicle_blueprint, sensors, traffic_config, recording_config
           FROM carla_configurations
           WHERE study_id = $1`,
          [session.rows[0].study_id]
        );
        const sensorConfig = await pool.query<{ sensors: unknown[] }>(
          `SELECT sensors FROM sensor_configurations WHERE study_id = $1`,
          [session.rows[0].study_id]
        );

        const config = carlaConfig.rows[0];
        if (config) {
          await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('simulator', 'load-map'), {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            routingKey: makeCommandRoutingKey('simulator', 'load-map'),
            producer: 'core-api',
            type: 'command',
            payload: {
              mapName: config.map,
              resetSettings: true
            },
            metadata: {
              studyId: session.rows[0].study_id,
              runId: session.rows[0].id,
              correlationId: null
            }
          });

          await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('simulator', 'set-weather'), {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            routingKey: makeCommandRoutingKey('simulator', 'set-weather'),
            producer: 'core-api',
            type: 'command',
            payload: {
              preset: config.weather_preset,
              custom: config.weather_custom
            },
            metadata: {
              studyId: session.rows[0].study_id,
              runId: session.rows[0].id,
              correlationId: null
            }
          });

          await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('simulator', 'spawn-vehicle'), {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            routingKey: makeCommandRoutingKey('simulator', 'spawn-vehicle'),
            producer: 'core-api',
            type: 'command',
            payload: {
              blueprint: config.ego_vehicle_blueprint,
              roleName: 'hero',
              autoPilot: false
            },
            metadata: {
              studyId: session.rows[0].study_id,
              runId: session.rows[0].id,
              correlationId: null
            }
          });

          await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('simulator', 'configure-sensors'), {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            routingKey: makeCommandRoutingKey('simulator', 'configure-sensors'),
            producer: 'core-api',
            type: 'command',
            payload: {
              sensors: config.sensors
            },
            metadata: {
              studyId: session.rows[0].study_id,
              runId: session.rows[0].id,
              correlationId: null
            }
          });

          await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('simulator', 'set-traffic'), {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            routingKey: makeCommandRoutingKey('simulator', 'set-traffic'),
            producer: 'core-api',
            type: 'command',
            payload: config.traffic_config,
            metadata: {
              studyId: session.rows[0].study_id,
              runId: session.rows[0].id,
              correlationId: null
            }
          });
        }

        await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('io', 'start-session'), {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          routingKey: makeCommandRoutingKey('io', 'start-session'),
          producer: 'core-api',
          type: 'command',
          payload: {
            sessionId: session.rows[0].id,
            studyId: session.rows[0].study_id,
            sensors: sensorConfig.rows[0]?.sensors ?? []
          },
          metadata: {
            studyId: session.rows[0].study_id,
            runId: session.rows[0].id,
            correlationId: null
          }
        });

        await pool.query(
          `UPDATE sessions
           SET status = 'running', started_at = COALESCE(started_at, NOW()), paused_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [session.rows[0].id]
        );

        await publishEvent(
          rabbit,
          makeEventRoutingKey(session.rows[0].study_id, session.rows[0].id, 'study', 'session.started'),
          {
            sessionId: session.rows[0].id,
            studyId: session.rows[0].study_id,
            startedAt: new Date().toISOString(),
            conditionId: session.rows[0].condition_id
          },
          { studyId: session.rows[0].study_id, runId: session.rows[0].id }
        );

        rabbit.resolvePending(correlationId, { ok: true });
        return;
      }
      case 'commands.session.pause':
      case 'commands.session.resume':
      case 'commands.session.complete':
      case 'commands.session.cancel': {
        const sessionId = String(message.payload.sessionId);
        const session = await pool.query<{ id: string; study_id: string; status: string; started_at: Date | null }>(
          `SELECT id, study_id, status, started_at FROM sessions WHERE id = $1`,
          [sessionId]
        );

        if (session.rowCount !== 1) {
          throw new Error('Session not found');
        }

        const current = session.rows[0];
        let nextStatus = current.status;
        const now = new Date().toISOString();
        let eventType = 'session.updated';

        if (message.routingKey === 'commands.session.pause') {
          nextStatus = 'paused';
          await pool.query(`UPDATE sessions SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1`, [sessionId]);
          eventType = 'session.paused';
        } else if (message.routingKey === 'commands.session.resume') {
          nextStatus = 'running';
          await pool.query(`UPDATE sessions SET status = 'running', paused_at = NULL, updated_at = NOW() WHERE id = $1`, [sessionId]);
          eventType = 'session.resumed';
        } else if (message.routingKey === 'commands.session.complete') {
          nextStatus = 'completed';
          await pool.query(
            `UPDATE sessions
             SET status = 'completed',
                 completed_at = NOW(),
                 duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, NOW())))::INTEGER,
                 updated_at = NOW()
             WHERE id = $1`,
            [sessionId]
          );
          eventType = 'session.completed';
        } else if (message.routingKey === 'commands.session.cancel') {
          nextStatus = 'cancelled';
          await pool.query(
            `UPDATE sessions
             SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [sessionId]
          );
          eventType = 'session.cancelled';
        }

        await rabbit.publish(RABBITMQ_EXCHANGES.commands, makeCommandRoutingKey('io', 'stop-session'), {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          routingKey: makeCommandRoutingKey('io', 'stop-session'),
          producer: 'core-api',
          type: 'command',
          payload: {
            sessionId
          },
          metadata: {
            studyId: current.study_id,
            runId: sessionId,
            correlationId: null
          }
        });

        await publishEvent(
          rabbit,
          makeEventRoutingKey(current.study_id, sessionId, 'study', eventType),
          {
            sessionId,
            status: nextStatus,
            timestamp: now,
            reason: message.payload.reason
          },
          { studyId: current.study_id, runId: sessionId }
        );

        rabbit.resolvePending(correlationId, { ok: true, status: nextStatus });
        return;
      }
      case 'commands.widget.trigger': {
        const studyId = String(message.metadata.studyId);
        const runId = String(message.metadata.runId);
        await publishEvent(
          rabbit,
          makeEventRoutingKey(studyId, runId, 'study', 'widget.triggered'),
          message.payload,
          {
            studyId,
            runId
          }
        );
        rabbit.resolvePending(correlationId, { ok: true });
        return;
      }
      default:
        logger.warn({ routingKey: message.routingKey }, 'unhandled command');
        rabbit.resolvePending(correlationId, { ok: true, skipped: true });
    }
  } catch (error) {
    logger.error({ err: error, routingKey: message.routingKey }, 'command handling failed');
    rabbit.rejectPending(correlationId, error instanceof Error ? error : new Error('command handling failed'));
  }
}

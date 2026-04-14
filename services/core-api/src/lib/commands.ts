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

interface SessionRow {
  id: string;
  study_id: string;
  participant_id: string | null;
  condition_id: string | null;
  status: string;
  started_at: Date | null;
}

interface CarlaConfigurationRow {
  map: string;
  weather_preset: string | null;
  weather_custom: Record<string, unknown>;
  ego_vehicle_blueprint: string;
  simulation_mode: string;
  fixed_delta_seconds: number;
  sensors: unknown[];
  traffic_config: Record<string, unknown>;
}

interface SensorConfigurationRow {
  sensors: unknown[];
}

async function publishEvent(
  pool: Pool,
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

  await pool.query(
    `INSERT INTO event_outbox (id, exchange, routing_key, message, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [message.id, RABBITMQ_EXCHANGES.events, routingKey, JSON.stringify(message)]
  );
  await rabbit.publish(RABBITMQ_EXCHANGES.events, routingKey, message);
  await pool.query(
    `UPDATE event_outbox
     SET status = 'published', attempts = attempts + 1, published_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [message.id]
  );
}

export async function publishPendingOutbox(pool: Pool, rabbit: RabbitManager, limit = 50): Promise<number> {
  const rows = await pool.query<{
    id: string;
    exchange: string;
    routing_key: string;
    message: RabbitMessage;
  }>(
    `SELECT id, exchange, routing_key, message
     FROM event_outbox
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  for (const row of rows.rows) {
    try {
      await rabbit.publish(row.exchange, row.routing_key, row.message);
      await pool.query(
        `UPDATE event_outbox
         SET status = 'published', attempts = attempts + 1, published_at = NOW(), last_error = NULL
         WHERE id = $1`,
        [row.id]
      );
    } catch (error) {
      await pool.query(
        `UPDATE event_outbox
         SET attempts = attempts + 1, last_error = $2
         WHERE id = $1`,
        [row.id, error instanceof Error ? error.message : 'publish failed']
      );
    }
  }

  return rows.rowCount ?? 0;
}

async function publishCommand(
  rabbit: RabbitManager,
  routingKey: string,
  payload: Record<string, unknown>,
  metadata: { studyId?: string; runId?: string } = {}
): Promise<void> {
  await rabbit.publish(RABBITMQ_EXCHANGES.commands, routingKey, {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    routingKey,
    producer: 'core-api',
    type: 'command',
    payload,
    metadata: {
      studyId: metadata.studyId ?? null,
      runId: metadata.runId ?? null,
      correlationId: null
    }
  });
}

async function publishSimulatorCommand(
  rabbit: RabbitManager,
  action: string,
  payload: Record<string, unknown>,
  metadata: { studyId?: string; runId?: string } = {}
): Promise<Record<string, unknown>> {
  return rabbit.publishAndWait(makeCommandRoutingKey('simulator', action), payload, metadata);
}

function commandFailure(code: 'NOT_FOUND' | 'CONFLICT', message: string): Error {
  return new Error(`${code}:${message}`);
}

function assertTransition(action: string, currentStatus: string): void {
  const rules: Record<string, string[]> = {
    start: ['created'],
    pause: ['running'],
    resume: ['paused'],
    complete: ['running'],
    cancel: ['running', 'paused']
  };

  const allowed = rules[action];
  if (!allowed?.includes(currentStatus)) {
    throw commandFailure('CONFLICT', `Session must be ${allowed?.join(' or ') ?? 'valid'} to ${action}`);
  }
}

async function loadSession(pool: Pool, sessionId: string): Promise<SessionRow> {
  const session = await pool.query<SessionRow>(
    `SELECT id, study_id, participant_id, condition_id, status, started_at
     FROM sessions
     WHERE id = $1`,
    [sessionId]
  );

  if (session.rowCount !== 1) {
    throw commandFailure('NOT_FOUND', 'Session not found');
  }

  return session.rows[0];
}

async function loadStudyRuntimeConfig(pool: Pool, studyId: string): Promise<{
  carla: CarlaConfigurationRow | null;
  sensors: SensorConfigurationRow | null;
  layoutId: string | null;
}> {
  const [carlaConfig, sensorConfig, layout] = await Promise.all([
    pool.query<CarlaConfigurationRow>(
      `SELECT map, weather_preset, weather_custom, ego_vehicle_blueprint, simulation_mode, fixed_delta_seconds, sensors, traffic_config
       FROM carla_configurations
       WHERE study_id = $1`,
      [studyId]
    ),
    pool.query<SensorConfigurationRow>(
      `SELECT sensors
       FROM sensor_configurations
       WHERE study_id = $1`,
      [studyId]
    ),
    pool.query<{ id: string }>(
      `SELECT id
       FROM view_layouts
       WHERE study_id = $1 AND type = 'participant'
       ORDER BY created_at DESC
       LIMIT 1`,
      [studyId]
    )
  ]);

  return {
    carla: carlaConfig.rows[0] ?? null,
    sensors: sensorConfig.rows[0] ?? null,
    layoutId: layout.rows[0]?.id ?? null
  };
}

async function updateRuntimeMetadata(
  pool: Pool,
  sessionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE sessions
     SET runtime_metadata = COALESCE(runtime_metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify(patch)]
  );
}

export async function handleCoreCommand(message: RabbitMessage, context: CommandContext): Promise<void> {
  const { logger, pool, rabbit } = context;
  const correlationId = message.metadata.correlationId;

  try {
    switch (message.routingKey) {
      case 'commands.session.start': {
        const session = await loadSession(pool, String(message.payload.sessionId));
        assertTransition('start', session.status);

        const runtimeConfig = await loadStudyRuntimeConfig(pool, session.study_id);
        const startedAt = new Date().toISOString();
        const cleanupBinding = async () => {
          try {
            await publishCommand(
              rabbit,
              makeCommandRoutingKey('simulator', 'unbind-session'),
              {
                sessionId: session.id,
                cleanup: true
              },
              { studyId: session.study_id, runId: session.id }
            );
          } catch (cleanupError) {
            logger.warn({ err: cleanupError, sessionId: session.id }, 'failed to release simulator binding after start failure');
          }
        };

        try {
          const simulator = await publishSimulatorCommand(
            rabbit,
            'bind-session',
            {
              sessionId: session.id,
              studyId: session.study_id,
              participantId: session.participant_id,
              conditionId: session.condition_id,
              config: {
                map: runtimeConfig.carla?.map ?? 'MockTown01',
                weather: {
                  preset: runtimeConfig.carla?.weather_preset ?? 'ClearNoon',
                  custom: runtimeConfig.carla?.weather_custom ?? {}
                },
                egoVehicle: {
                  blueprint: runtimeConfig.carla?.ego_vehicle_blueprint ?? 'vehicle.lincoln.mkz_2020'
                },
                sensors: runtimeConfig.carla?.sensors ?? [],
                traffic: runtimeConfig.carla?.traffic_config ?? {},
                simulationMode: runtimeConfig.carla?.simulation_mode ?? 'synchronous',
                fixedDeltaSeconds: Number(runtimeConfig.carla?.fixed_delta_seconds ?? 0.05)
              }
            },
            { studyId: session.study_id, runId: session.id }
          );

          await publishCommand(
            rabbit,
            makeCommandRoutingKey('io', 'start-session'),
            {
              sessionId: session.id,
              studyId: session.study_id,
              sensors: runtimeConfig.sensors?.sensors ?? []
            },
            { studyId: session.study_id, runId: session.id }
          );

          await pool.query(
            `UPDATE sessions
             SET status = 'running',
                 started_at = COALESCE(started_at, NOW()),
                 paused_at = NULL,
                 completed_at = NULL,
                 runtime_metadata = COALESCE(runtime_metadata, '{}'::jsonb) || $2::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [
              session.id,
              JSON.stringify({
                lifecycle: {
                  previousStatus: session.status,
                  status: 'running',
                  startedAt,
                  updatedAt: startedAt
                },
                simulator: {
                  binding: 'bound',
                  adapterId: simulator.adapterId ?? null,
                  simulatorType: simulator.simulatorType ?? null,
                  updatedAt: startedAt
                },
                layoutId: runtimeConfig.layoutId,
                sensors: runtimeConfig.sensors?.sensors ?? []
              })
            ]
          );

          await publishEvent(
            pool,
            rabbit,
            makeEventRoutingKey(session.study_id, session.id, 'study', 'session.started'),
            {
              sessionId: session.id,
              studyId: session.study_id,
              participantId: session.participant_id,
              conditionId: session.condition_id,
              status: 'running',
              previousStatus: session.status,
              startedAt,
              runtimeMetadata: {
                layoutId: runtimeConfig.layoutId,
                simulator
              }
            },
            { studyId: session.study_id, runId: session.id }
          );

          rabbit.resolvePending(correlationId, { ok: true });
          return;
        } catch (error) {
          await cleanupBinding();
          throw error;
        }
      }
      case 'commands.session.pause':
      case 'commands.session.resume':
      case 'commands.session.complete':
      case 'commands.session.cancel': {
        const sessionId = String(message.payload.sessionId);
        const current = await loadSession(pool, sessionId);
        const action = message.routingKey.replace('commands.session.', '');
        assertTransition(action, current.status);
        let nextStatus = current.status;
        const now = new Date().toISOString();
        let eventType = 'session.updated';
        let ioRoutingKey: string | null = null;
        let ioPayload: Record<string, unknown> | null = null;
        let durationSeconds: number | null = null;
        let simulatorStatePatch: Record<string, unknown> | null = null;

        if (message.routingKey === 'commands.session.pause') {
          const simulator = await publishSimulatorCommand(
            rabbit,
            'pause-session',
            { sessionId },
            { studyId: current.study_id, runId: sessionId }
          );
          nextStatus = 'paused';
          await pool.query(`UPDATE sessions SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1`, [sessionId]);
          eventType = 'session.paused';
          ioRoutingKey = makeCommandRoutingKey('io', 'stop-session');
          ioPayload = { sessionId };
          simulatorStatePatch = {
            binding: 'paused',
            adapterId: simulator.adapterId ?? null,
            simulatorType: simulator.simulatorType ?? null,
            updatedAt: now
          };
        } else if (message.routingKey === 'commands.session.resume') {
          const runtimeConfig = await loadStudyRuntimeConfig(pool, current.study_id);
          const simulator = await publishSimulatorCommand(
            rabbit,
            'resume-session',
            { sessionId },
            { studyId: current.study_id, runId: sessionId }
          );
          nextStatus = 'running';
          await pool.query(`UPDATE sessions SET status = 'running', paused_at = NULL, updated_at = NOW() WHERE id = $1`, [sessionId]);
          eventType = 'session.resumed';
          ioRoutingKey = makeCommandRoutingKey('io', 'start-session');
          ioPayload = {
            sessionId,
            studyId: current.study_id,
            sensors: runtimeConfig.sensors?.sensors ?? []
          };
          simulatorStatePatch = {
            binding: 'bound',
            adapterId: simulator.adapterId ?? null,
            simulatorType: simulator.simulatorType ?? null,
            updatedAt: now
          };
        } else if (message.routingKey === 'commands.session.complete') {
          const simulator = await publishSimulatorCommand(
            rabbit,
            'unbind-session',
            { sessionId, cleanup: true },
            { studyId: current.study_id, runId: sessionId }
          );
          nextStatus = 'completed';
          const result = await pool.query<{ duration_seconds: number }>(
            `UPDATE sessions
             SET status = 'completed',
                 completed_at = NOW(),
                 duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, NOW())))::INTEGER,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING duration_seconds`,
            [sessionId]
          );
          durationSeconds = result.rows[0]?.duration_seconds ?? null;
          eventType = 'session.completed';
          ioRoutingKey = makeCommandRoutingKey('io', 'stop-session');
          ioPayload = { sessionId };
          simulatorStatePatch = {
            binding: 'released',
            adapterId: simulator.adapterId ?? null,
            simulatorType: simulator.simulatorType ?? null,
            updatedAt: now
          };
        } else if (message.routingKey === 'commands.session.cancel') {
          const simulator = await publishSimulatorCommand(
            rabbit,
            'unbind-session',
            { sessionId, cleanup: true },
            { studyId: current.study_id, runId: sessionId }
          );
          nextStatus = 'cancelled';
          await pool.query(
            `UPDATE sessions
             SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [sessionId]
          );
          eventType = 'session.cancelled';
          ioRoutingKey = makeCommandRoutingKey('io', 'stop-session');
          ioPayload = { sessionId };
          simulatorStatePatch = {
            binding: 'released',
            adapterId: simulator.adapterId ?? null,
            simulatorType: simulator.simulatorType ?? null,
            updatedAt: now
          };
        }

        if (ioRoutingKey && ioPayload) {
          await publishCommand(rabbit, ioRoutingKey, ioPayload, {
            studyId: current.study_id,
            runId: sessionId
          });
        }

        await updateRuntimeMetadata(pool, sessionId, {
          lifecycle: {
            previousStatus: current.status,
            status: nextStatus,
            updatedAt: now
          },
          ...(simulatorStatePatch ? { simulator: simulatorStatePatch } : {})
        });

        await publishEvent(
          pool,
          rabbit,
          makeEventRoutingKey(current.study_id, sessionId, 'study', eventType),
          {
            sessionId,
            studyId: current.study_id,
            status: nextStatus,
            previousStatus: current.status,
            timestamp: now,
            reason: message.payload.reason,
            durationSeconds
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
          pool,
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

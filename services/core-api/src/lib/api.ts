import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  componentStatusSchema,
  conditionSchema,
  dashboardSchema,
  layoutConfigSchema,
  loginResponseSchema,
  loginSchema,
  makeCommandRoutingKey,
  onboardingResearcherSchema,
  onboardingSystemSchema,
  participantSchema,
  refreshSchema,
  RoleSchema,
  sessionSchema,
  studySummarySchema,
  systemConfigurationSchema,
  websocketSubscriptionMessageSchema
} from '@scarline/contracts';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { CoreApiConfig } from './config.js';
import type { RabbitManager } from './rabbit.js';
import type { WebSocketHub } from './websocket-hub.js';
import type { ComponentRegistry } from './component-status.js';
import {
  getSystemConfiguration,
  queryMany,
  queryOne,
  upsertSystemConfiguration
} from './data.js';
import {
  hashPassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword
} from './auth.js';
import { loadWidgetCatalogue } from './widget-catalogue.js';
import { registerPrdRoutes } from './prd-routes.js';

interface Dependencies {
  config: CoreApiConfig;
  pool: Pool;
  rabbit: RabbitManager;
  wsHub: WebSocketHub;
  components: ComponentRegistry;
}

function getBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  return header.slice('Bearer '.length);
}

function apiError(code: string, message: string): {
  success: false;
  data: null;
  error: { code: string; message: string; details: Record<string, unknown> };
} {
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
      details: {}
    }
  };
}

async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  config: CoreApiConfig,
  roles?: Array<z.infer<typeof RoleSchema>>
): Promise<z.infer<typeof RoleSchema>[] | null> {
  const token = getBearerToken(request);
  if (!token) {
    reply.code(401);
    return null;
  }

  try {
    const claims = verifyAccessToken(token, config);
    const userRoles = z.array(RoleSchema).parse(claims.roles ?? []);
    if (roles && !roles.some((role) => userRoles.includes(role))) {
      reply.code(403);
      return null;
    }

    return userRoles;
  } catch {
    reply.code(401);
    return null;
  }
}

function rolesForRoute(method: string, path: string): Array<z.infer<typeof RoleSchema>> | undefined {
  if (
    path.startsWith('/api/users')
    || path.startsWith('/api/devices')
    || path.startsWith('/api/system/configuration')
    || path.startsWith('/api/system/process-manager')
    || path.startsWith('/api/system/carla')
    || path.startsWith('/api/system/overlay')
    || path.startsWith('/api/system/restart')
  ) {
    return ['admin'];
  }

  if (method === 'GET') {
    return ['admin', 'researcher', 'operator', 'viewer'];
  }

  if (
    path.includes('/sessions/') && (
      path.endsWith('/start')
      || path.endsWith('/pause')
      || path.endsWith('/resume')
      || path.endsWith('/complete')
      || path.endsWith('/cancel')
      || path.endsWith('/triggers')
    )
  ) {
    return ['admin', 'researcher', 'operator'];
  }

  if (path.startsWith('/api/exports')) {
    return ['admin', 'researcher'];
  }

  return ['admin', 'researcher'];
}

async function scanWidgetsDir(config: CoreApiConfig): Promise<string[]> {
  try {
    const entries = await fs.readdir(config.WIDGETS_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function toCommandFailure(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof Error) {
    if (error.message.startsWith('NOT_FOUND:')) {
      return {
        status: 404,
        code: 'NOT_FOUND',
        message: error.message.slice('NOT_FOUND:'.length).trim()
      };
    }

    if (error.message.startsWith('CONFLICT:')) {
      return {
        status: 409,
        code: 'STATE_CONFLICT',
        message: error.message.slice('CONFLICT:'.length).trim()
      };
    }

    return {
      status: 500,
      code: 'COMMAND_FAILED',
      message: error.message
    };
  }

  return {
    status: 500,
    code: 'COMMAND_FAILED',
    message: 'Command handling failed'
  };
}

async function runCommand<T>(
  reply: FastifyReply,
  fn: () => Promise<T>
): Promise<{
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details: Record<string, unknown> } | null;
}> {
  try {
    const data = await fn();
    return {
      success: true,
      data,
      error: null
    };
  } catch (error) {
    const failure = toCommandFailure(error);
    reply.code(failure.status);
    return {
      success: false,
      data: null,
      error: {
        code: failure.code,
        message: failure.message,
        details: {}
      }
    };
  }
}

export async function registerApi(app: FastifyInstance, deps: Dependencies): Promise<void> {
  const { config, pool, rabbit, wsHub, components } = deps;

  app.get('/api/health', async (_request, reply) => {
    let database = 'healthy';
    try {
      await pool.query('SELECT 1');
    } catch {
      database = 'error';
    }

    reply.send({
      success: true,
      data: {
        status: database === 'healthy' ? 'healthy' : 'degraded',
        components: components.list(),
        database,
        rabbitmq: 'healthy'
      },
      error: null
    });
  });

  app.get('/api/system/bootstrap', async () => {
    const systemConfig = await getSystemConfiguration(pool);
    return {
      success: true,
      data: {
        onboardingCompleted: Boolean(systemConfig.onboarding_completed)
      },
      error: null
    };
  });

  app.get('/api/onboarding/status', async () => {
    const systemConfig = await getSystemConfiguration(pool);
    return {
      success: true,
      data: {
        onboardingCompleted: Boolean(systemConfig.onboarding_completed)
      },
      error: null
    };
  });

  app.post('/api/onboarding/system', async (request) => {
    const payload = onboardingSystemSchema.parse(request.body ?? {});
    await upsertSystemConfiguration(pool, {
      carla_server_path: payload.carlaServerPath,
      data_directory: payload.dataDirectory,
      scarline_port: payload.platformPort,
      carla_server_port: payload.carlaServerPort,
      overlay_transparent_enabled: payload.transparentOverlayEnabled
    });

    return {
      success: true,
      data: payload,
      error: null
    };
  });

  app.post('/api/onboarding/researcher', async (request) => {
    const payload = onboardingResearcherSchema.parse(request.body ?? {});
    const passwordHash = await hashPassword(payload.password);

    const researcher = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO researchers (name, institution, role, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [payload.fullName, payload.institution ?? null, payload.role ?? null, payload.email ?? null]
    );

    const user = await queryOne<{ id: string; username: string; display_name: string; email: string | null }>(
      pool,
      `INSERT INTO users (researcher_id, username, password_hash, display_name, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, email`,
      [researcher?.id ?? null, payload.username, passwordHash, payload.fullName, payload.email ?? null]
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'admin'`,
      [user?.id]
    );
    await upsertSystemConfiguration(pool, { onboarding_completed: true });

    return {
      success: true,
      data: {
        researcherId: researcher?.id,
        userId: user?.id
      },
      error: null
    };
  });

  app.post('/api/onboarding/complete', async () => {
    await upsertSystemConfiguration(pool, { onboarding_completed: true });
    return {
      success: true,
      data: { onboardingCompleted: true },
      error: null
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const payload = loginSchema.parse(request.body ?? {});
    const user = await queryOne<{
      id: string;
      username: string;
      password_hash: string;
      display_name: string;
      email: string | null;
      roles: string[];
    }>(
      pool,
      `SELECT users.id,
              users.username,
              users.password_hash,
              users.display_name,
              users.email,
              ARRAY_REMOVE(ARRAY_AGG(roles.name), NULL) AS roles
       FROM users
       LEFT JOIN user_roles ON user_roles.user_id = users.id
       LEFT JOIN roles ON roles.id = user_roles.role_id
       WHERE users.username = $1
         AND users.is_active = TRUE
       GROUP BY users.id`,
      [payload.username]
    );

    if (!user || !(await verifyPassword(payload.password, user.password_hash))) {
      reply.code(401);
      return {
        success: false,
        data: null,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
          details: {}
        }
      };
    }

    const accessToken = signAccessToken(
      {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        roles: z.array(RoleSchema).parse(user.roles)
      },
      config
    );
    const refreshToken = await issueRefreshToken(pool, user.id);
    const data = loginResponseSchema.parse({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        roles: user.roles
      }
    });

    return { success: true, data, error: null };
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const payload = refreshSchema.parse(request.body ?? {});
    const rotated = await rotateRefreshToken(pool, payload.refreshToken);
    if (!rotated) {
      reply.code(401);
      return {
        success: false,
        data: null,
        error: {
          code: 'TOKEN_INVALID',
          message: 'Refresh token is invalid or expired',
          details: {}
        }
      };
    }

    return {
      success: true,
      data: {
        refreshToken: rotated
      },
      error: null
    };
  });

  app.post('/api/auth/logout', async (request) => {
    const payload = refreshSchema.parse(request.body ?? {});
    await revokeRefreshToken(pool, payload.refreshToken);
    return {
      success: true,
      data: { revoked: true },
      error: null
    };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const token = getBearerToken(request);
    if (!token) {
      reply.code(401);
      return {
        success: false,
        data: null,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          details: {}
        }
      };
    }

    const claims = verifyAccessToken(token, config);
    return {
      success: true,
      data: claims,
      error: null
    };
  });

  app.get('/api/system/components', async () => {
    const data = components.list().map((entry) => componentStatusSchema.parse(entry));
    return { success: true, data, error: null };
  });

  app.post('/api/system/component-status', async (request) => {
    const payload = componentStatusSchema.parse(request.body ?? {});
    components.upsert(payload);
    wsHub.broadcast('system.health', payload as Record<string, unknown>);
    return { success: true, data: payload, error: null };
  });

  app.post('/api/system/ready', async () => {
    const payload = {
      componentId: 'core-api',
      componentName: 'Core API',
      status: 'running',
      checkedAt: new Date().toISOString(),
      message: 'Process manager reported ready'
    } as const;
    components.upsert(payload as never);
    return { success: true, data: payload, error: null };
  });

  app.post('/api/system/shutdown', async () => ({
    success: true,
    data: {
      acknowledged: true
    },
    error: null
  }));

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (
      !path.startsWith('/api/')
      || path.startsWith('/api/auth/')
      || path === '/api/health'
      || path.startsWith('/api/onboarding/')
      || path === '/api/system/bootstrap'
      || path === '/api/system/ready'
      || path === '/api/system/shutdown'
      || path === '/api/system/component-status'
    ) {
      return;
    }

    const roles = await requireUser(request, reply, config, rolesForRoute(request.method, path));
    if (!roles) {
      return reply.send(apiError(reply.statusCode === 403 ? 'FORBIDDEN' : 'AUTH_REQUIRED', reply.statusCode === 403 ? 'Forbidden' : 'Authentication required'));
    }
  });

  app.get('/api/system/configuration', async (request, reply) => {
    const roles = await requireUser(request, reply, config, ['admin']);
    if (!roles) {
      return {
        success: false,
        data: null,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          details: {}
        }
      };
    }

    const raw = await getSystemConfiguration(pool);
    const data = systemConfigurationSchema.parse({
      carlaServerPath: raw.carla_server_path ?? null,
      dataDirectory: raw.data_directory ?? '.scarline-runtime',
      platformPort: Number(raw.scarline_port ?? 8088),
      carlaServerPort: Number(raw.carla_server_port ?? 2000),
      transparentOverlayEnabled: Boolean(raw.overlay_transparent_enabled ?? true),
      onboardingCompleted: Boolean(raw.onboarding_completed),
      environment: raw.platform_env === 'production' ? 'production' : 'development'
    });

    return { success: true, data, error: null };
  });

  app.put('/api/system/configuration', async (request, reply) => {
    const roles = await requireUser(request, reply, config, ['admin']);
    if (!roles) {
      return {
        success: false,
        data: null,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          details: {}
        }
      };
    }

    const payload = onboardingSystemSchema.parse(request.body ?? {});
    await upsertSystemConfiguration(pool, {
      carla_server_path: payload.carlaServerPath,
      data_directory: payload.dataDirectory,
      scarline_port: payload.platformPort,
      carla_server_port: payload.carlaServerPort,
      overlay_transparent_enabled: payload.transparentOverlayEnabled
    });

    return { success: true, data: payload, error: null };
  });

  app.get('/api/dashboard', async (request, reply) => {
    const roles = await requireUser(request, reply, config);
    if (!roles) {
      return {
        success: false,
        data: null,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          details: {}
        }
      };
    }

    const counts = await queryOne<{ active_studies: string; total_sessions: string; total_participants: string; total_events: string }>(
      pool,
      `SELECT
         (SELECT COUNT(*)::text FROM studies WHERE status = 'active') AS active_studies,
         (SELECT COUNT(*)::text FROM sessions) AS total_sessions,
         (SELECT COUNT(*)::text FROM participants) AS total_participants,
         (SELECT COUNT(*)::text FROM session_events) AS total_events`
    );
    const recentSessions = await queryMany(pool, `SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5`);
    const data = dashboardSchema.parse({
      activeStudies: Number(counts?.active_studies ?? 0),
      totalSessions: Number(counts?.total_sessions ?? 0),
      totalParticipants: Number(counts?.total_participants ?? 0),
      totalEvents: Number(counts?.total_events ?? 0),
      recentSessions: recentSessions.map((row) => ({
        id: row.id,
        studyId: row.study_id,
        participantId: row.participant_id,
        conditionId: row.condition_id,
        name: row.name,
        status: row.status,
        startedAt: row.started_at?.toISOString?.() ?? null,
        pausedAt: row.paused_at?.toISOString?.() ?? null,
        completedAt: row.completed_at?.toISOString?.() ?? null,
        durationSeconds: row.duration_seconds,
        runtimeMetadata: row.runtime_metadata ?? {},
        notes: row.notes
      })),
      componentHealth: components.list()
    });
    return { success: true, data, error: null };
  });

  app.get('/api/studies', async (request) => {
    const query = z.object({
      status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
      researcher: z.string().uuid().optional(),
      search: z.string().optional()
    }).parse(request.query ?? {});
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (query.status) {
      values.push(query.status);
      clauses.push(`studies.status = $${values.length}`);
    }
    if (query.researcher) {
      values.push(query.researcher);
      clauses.push(`study_researchers.researcher_id = $${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
      clauses.push(`(studies.name ILIKE $${values.length} OR studies.description ILIKE $${values.length})`);
    }

    const rows = await queryMany(pool, `
      SELECT studies.id,
             studies.name,
             studies.description,
             studies.status,
             studies.created_at,
             studies.updated_at,
             COUNT(DISTINCT participants.id) AS participant_count,
             COUNT(DISTINCT sessions.id) AS session_count
      FROM studies
      LEFT JOIN study_researchers ON study_researchers.study_id = studies.id
      LEFT JOIN participants ON participants.study_id = studies.id
      LEFT JOIN sessions ON sessions.study_id = studies.id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY studies.id
      ORDER BY studies.created_at DESC
    `, values);
    const data = rows.map((row) => studySummarySchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      participantCount: Number(row.participant_count),
      sessionCount: Number(row.session_count),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
    return { success: true, data, error: null };
  });

  app.post('/api/studies', async (request) => {
    const payload = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      createdBy: z.string().uuid().nullable().optional()
    }).parse(request.body ?? {});

    const study = await queryOne(pool, `
      INSERT INTO studies (name, description, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, name, description, status, created_at, updated_at
    `, [payload.name, payload.description ?? null, payload.createdBy ?? null]);

    if (study) {
      await pool.query(`INSERT INTO carla_configurations (study_id) VALUES ($1) ON CONFLICT (study_id) DO NOTHING`, [study.id]);
      await pool.query(`INSERT INTO sensor_configurations (study_id) VALUES ($1) ON CONFLICT (study_id) DO NOTHING`, [study.id]);
    }

    return {
      success: true,
      data: study,
      error: null
    };
  });

  app.get('/api/studies/:id', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const study = await queryOne(pool, `SELECT * FROM studies WHERE id = $1`, [params.id]);
    if (!study) {
      reply.code(404);
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Study not found', details: {} }
      };
    }
    return { success: true, data: study, error: null };
  });

  app.put('/api/studies/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional()
    }).parse(request.body ?? {});

    const updated = await queryOne(pool, `
      UPDATE studies
      SET name = $2, description = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [params.id, payload.name, payload.description ?? null]);

    return { success: true, data: updated, error: null };
  });

  app.put('/api/studies/:id/status', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = z.object({ status: z.enum(['draft', 'active', 'completed', 'archived']) }).parse(request.body ?? {});
    const updated = await queryOne(pool, `UPDATE studies SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [params.id, payload.status]);
    return { success: true, data: updated, error: null };
  });

  app.get('/api/studies/:studyId/participants', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const rows = await queryMany(pool, `SELECT * FROM participants WHERE study_id = $1 ORDER BY participant_code`, [params.studyId]);
    return {
      success: true,
      data: rows.map((row) => participantSchema.parse({
        id: row.id,
        studyId: row.study_id,
        participantCode: row.participant_code,
        demographicData: row.demographic_data,
        assignedConditionId: row.assigned_condition_id,
        notes: row.notes
      })),
      error: null
    };
  });

  app.post('/api/studies/:studyId/participants', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      participantCode: z.string().min(1),
      demographicData: z.record(z.string(), z.unknown()).default({}),
      assignedConditionId: z.string().uuid().nullable().optional(),
      notes: z.string().nullable().optional()
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      INSERT INTO participants (study_id, participant_code, demographic_data, assigned_condition_id, notes)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      RETURNING *
    `, [params.studyId, payload.participantCode, JSON.stringify(payload.demographicData), payload.assignedConditionId ?? null, payload.notes ?? null]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/participants/:id', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      participantCode: z.string().min(1),
      demographicData: z.record(z.string(), z.unknown()).default({}),
      assignedConditionId: z.string().uuid().nullable().optional(),
      notes: z.string().nullable().optional()
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE participants
      SET participant_code = $3,
          demographic_data = $4::jsonb,
          assigned_condition_id = $5,
          notes = $6,
          updated_at = NOW()
      WHERE study_id = $1 AND id = $2
      RETURNING *
    `, [params.studyId, params.id, payload.participantCode, JSON.stringify(payload.demographicData), payload.assignedConditionId ?? null, payload.notes ?? null]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/participants/:id/assign-condition', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const payload = z.object({ conditionId: z.string().uuid().nullable() }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE participants
      SET assigned_condition_id = $3, updated_at = NOW()
      WHERE study_id = $1 AND id = $2
      RETURNING *
    `, [params.studyId, params.id, payload.conditionId]);
    return { success: true, data: row, error: null };
  });

  app.get('/api/studies/:studyId/conditions', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const rows = await queryMany(pool, `SELECT * FROM conditions WHERE study_id = $1 ORDER BY "order" ASC`, [params.studyId]);
    return {
      success: true,
      data: rows.map((row) => conditionSchema.parse({
        id: row.id,
        studyId: row.study_id,
        name: row.name,
        description: row.description,
        order: row.order,
        carlaOverrides: row.carla_overrides,
        widgetOverrides: row.widget_overrides
      })),
      error: null
    };
  });

  app.post('/api/studies/:studyId/conditions', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      order: z.number().int().default(0),
      carlaOverrides: z.record(z.string(), z.unknown()).default({}),
      widgetOverrides: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      INSERT INTO conditions (study_id, name, description, "order", carla_overrides, widget_overrides)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      RETURNING *
    `, [params.studyId, payload.name, payload.description ?? null, payload.order, JSON.stringify(payload.carlaOverrides), JSON.stringify(payload.widgetOverrides)]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/conditions/:id', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      order: z.number().int().default(0),
      carlaOverrides: z.record(z.string(), z.unknown()).default({}),
      widgetOverrides: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE conditions
      SET name = $3,
          description = $4,
          "order" = $5,
          carla_overrides = $6::jsonb,
          widget_overrides = $7::jsonb,
          updated_at = NOW()
      WHERE study_id = $1 AND id = $2
      RETURNING *
    `, [params.studyId, params.id, payload.name, payload.description ?? null, payload.order, JSON.stringify(payload.carlaOverrides), JSON.stringify(payload.widgetOverrides)]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/conditions/reorder', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      conditionIds: z.array(z.string().uuid())
    }).parse(request.body ?? {});

    for (const [index, id] of payload.conditionIds.entries()) {
      await pool.query(`UPDATE conditions SET "order" = $3, updated_at = NOW() WHERE study_id = $1 AND id = $2`, [params.studyId, id, index]);
    }

    return { success: true, data: { reordered: true }, error: null };
  });

  app.get('/api/studies/:studyId/sessions', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const rows = await queryMany(pool, `SELECT * FROM sessions WHERE study_id = $1 ORDER BY created_at DESC`, [params.studyId]);
    return {
      success: true,
      data: rows.map((row) => sessionSchema.parse({
        id: row.id,
        studyId: row.study_id,
        participantId: row.participant_id,
        conditionId: row.condition_id,
        name: row.name,
        status: row.status,
        startedAt: row.started_at?.toISOString?.() ?? null,
        pausedAt: row.paused_at?.toISOString?.() ?? null,
        completedAt: row.completed_at?.toISOString?.() ?? null,
        durationSeconds: row.duration_seconds,
        runtimeMetadata: row.runtime_metadata,
        notes: row.notes
      })),
      error: null
    };
  });

  app.post('/api/studies/:studyId/sessions', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      participantId: z.string().uuid().nullable().optional(),
      conditionId: z.string().uuid().nullable().optional(),
      name: z.string().nullable().optional()
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      INSERT INTO sessions (study_id, participant_id, condition_id, name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [params.studyId, payload.participantId ?? null, payload.conditionId ?? null, payload.name ?? null]);
    return { success: true, data: row, error: null };
  });

  app.get('/api/studies/:studyId/sessions/:id', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const row = await queryOne(pool, `SELECT * FROM sessions WHERE study_id = $1 AND id = $2`, [params.studyId, params.id]);
    return { success: true, data: row, error: null };
  });

  app.post('/api/studies/:studyId/sessions/:id/start', async (request, reply) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    return runCommand(reply, () => rabbit.publishAndWait(makeCommandRoutingKey('session', 'start'), {
      sessionId: params.id,
      studyId: params.studyId
    }, { studyId: params.studyId, runId: params.id }));
  });

  app.post('/api/studies/:studyId/sessions/:id/pause', async (request, reply) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    return runCommand(reply, () => rabbit.publishAndWait(makeCommandRoutingKey('session', 'pause'), {
      sessionId: params.id
    }, { studyId: params.studyId, runId: params.id }));
  });

  app.post('/api/studies/:studyId/sessions/:id/resume', async (request, reply) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    return runCommand(reply, () => rabbit.publishAndWait(makeCommandRoutingKey('session', 'resume'), {
      sessionId: params.id
    }, { studyId: params.studyId, runId: params.id }));
  });

  app.post('/api/studies/:studyId/sessions/:id/complete', async (request, reply) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    return runCommand(reply, () => rabbit.publishAndWait(makeCommandRoutingKey('session', 'complete'), {
      sessionId: params.id
    }, { studyId: params.studyId, runId: params.id }));
  });

  app.post('/api/studies/:studyId/sessions/:id/cancel', async (request, reply) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const payload = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
    return runCommand(reply, () => rabbit.publishAndWait(makeCommandRoutingKey('session', 'cancel'), {
      sessionId: params.id,
      reason: payload.reason
    }, { studyId: params.studyId, runId: params.id }));
  });

  app.get('/api/studies/:studyId/carla-config', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const row = await queryOne(pool, `SELECT * FROM carla_configurations WHERE study_id = $1`, [params.studyId]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/carla-config', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      map: z.string().default('Town03'),
      weatherPreset: z.string().nullable().optional(),
      weatherCustom: z.record(z.string(), z.unknown()).default({}),
      egoVehicleBlueprint: z.string().default('vehicle.lincoln.mkz_2020'),
      simulationMode: z.enum(['synchronous', 'asynchronous']).default('synchronous'),
      fixedDeltaSeconds: z.number().default(0.05),
      trafficConfig: z.record(z.string(), z.unknown()).default({}),
      pedestrianConfig: z.record(z.string(), z.unknown()).default({}),
      sunConfig: z.record(z.string(), z.unknown()).default({}),
      spectatorConfig: z.record(z.string(), z.unknown()).default({}),
      recordingConfig: z.record(z.string(), z.unknown()).default({}),
      sensors: z.array(z.record(z.string(), z.unknown())).default([])
    }).parse(request.body ?? {});

    const row = await queryOne(pool, `
      INSERT INTO carla_configurations (
        study_id, map, weather_preset, weather_custom, ego_vehicle_blueprint,
        simulation_mode, fixed_delta_seconds, traffic_config, pedestrian_config,
        sun_config, spectator_config, recording_config, sensors
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5,
        $6, $7, $8::jsonb, $9::jsonb,
        $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb
      )
      ON CONFLICT (study_id) DO UPDATE SET
        map = EXCLUDED.map,
        weather_preset = EXCLUDED.weather_preset,
        weather_custom = EXCLUDED.weather_custom,
        ego_vehicle_blueprint = EXCLUDED.ego_vehicle_blueprint,
        simulation_mode = EXCLUDED.simulation_mode,
        fixed_delta_seconds = EXCLUDED.fixed_delta_seconds,
        traffic_config = EXCLUDED.traffic_config,
        pedestrian_config = EXCLUDED.pedestrian_config,
        sun_config = EXCLUDED.sun_config,
        spectator_config = EXCLUDED.spectator_config,
        recording_config = EXCLUDED.recording_config,
        sensors = EXCLUDED.sensors,
        updated_at = NOW()
      RETURNING *
    `, [
      params.studyId,
      payload.map,
      payload.weatherPreset ?? null,
      JSON.stringify(payload.weatherCustom),
      payload.egoVehicleBlueprint,
      payload.simulationMode,
      payload.fixedDeltaSeconds,
      JSON.stringify(payload.trafficConfig),
      JSON.stringify(payload.pedestrianConfig),
      JSON.stringify(payload.sunConfig),
      JSON.stringify(payload.spectatorConfig),
      JSON.stringify(payload.recordingConfig),
      JSON.stringify(payload.sensors)
    ]);

    return { success: true, data: row, error: null };
  });

  app.get('/api/carla/presets/maps', async () => ({
    success: true,
    data: ['Town01', 'Town03', 'Town05', 'Town10', 'Town12'],
    error: null
  }));

  app.get('/api/carla/presets/weather', async () => ({
    success: true,
    data: ['ClearNoon', 'CloudyNoon', 'HardRainNoon', 'ClearSunset', 'MidRainSunset'],
    error: null
  }));

  app.get('/api/carla/presets/vehicles', async () => ({
    success: true,
    data: ['vehicle.lincoln.mkz_2020', 'vehicle.toyota.prius', 'vehicle.audi.etron'],
    error: null
  }));

  app.get('/api/carla/presets/sensors', async () => ({
    success: true,
    data: ['sensor.camera.rgb', 'sensor.other.gnss', 'sensor.other.imu', 'sensor.other.collision'],
    error: null
  }));

  app.get('/api/studies/:studyId/sensor-config', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const row = await queryOne(pool, `SELECT * FROM sensor_configurations WHERE study_id = $1`, [params.studyId]);
    return { success: true, data: row, error: null };
  });

  app.put('/api/studies/:studyId/sensor-config', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      sensors: z.array(z.record(z.string(), z.unknown())).default([])
    }).parse(request.body ?? {});
    const sensors = payload.sensors.map((sensor) => {
      const driver = sensor.driver ?? sensor.driverId;
      return driver ? { ...sensor, driver, driverId: driver } : sensor;
    });
    const row = await queryOne(pool, `
      INSERT INTO sensor_configurations (study_id, sensors)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (study_id) DO UPDATE SET sensors = EXCLUDED.sensors, updated_at = NOW()
      RETURNING *
    `, [params.studyId, JSON.stringify(sensors)]);
    return { success: true, data: row, error: null };
  });

  app.get('/api/sensors/drivers', async () => ({
    success: true,
    data: [
      { driverId: 'logitech_g29', sensorType: 'steering_wheel', displayName: 'Logitech G29' },
      { driverId: 'usb_camera', sensorType: 'camera', displayName: 'USB Camera' }
    ],
    error: null
  }));

  app.get('/api/studies/:studyId/layouts', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const rows = await queryMany(pool, `SELECT * FROM view_layouts WHERE study_id = $1 ORDER BY created_at DESC`, [params.studyId]);
    return { success: true, data: rows, error: null };
  });

  app.post('/api/studies/:studyId/layouts', async (request) => {
    const params = z.object({ studyId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      type: z.enum(['participant', 'researcher_monitor']).default('participant'),
      targetDisplay: z.string().default('0'),
      layoutConfig: z.object({
        zones: z.array(z.object({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
          display: z.number().default(0)
        })).min(1),
        widgets: z.array(z.object({
          id: z.string().uuid(),
          widgetId: z.string(),
          zoneId: z.string(),
          order: z.number().default(0),
          bindingsConfig: z.record(z.string(), z.unknown()).default({}),
          triggerRules: z.array(z.record(z.string(), z.unknown())).default([]),
          styleOverrides: z.record(z.string(), z.unknown()).default({})
        })).default([])
      })
    }).parse(request.body ?? {});

    const layoutId = randomUUID();
    const row = await queryOne(pool, `
      INSERT INTO view_layouts (id, study_id, name, type, target_display, layout_config)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *
    `, [layoutId, params.studyId, payload.name, payload.type, payload.targetDisplay, JSON.stringify(payload.layoutConfig)]);

    for (const widget of payload.layoutConfig.widgets) {
      await pool.query(
        `INSERT INTO widget_instances (id, layout_id, widget_id, zone_id, "order", bindings_config, trigger_rules, style_overrides)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
        [
          widget.id,
          layoutId,
          widget.widgetId,
          widget.zoneId,
          widget.order,
          JSON.stringify(widget.bindingsConfig),
          JSON.stringify(widget.triggerRules),
          JSON.stringify(widget.styleOverrides)
        ]
      );
    }

    return { success: true, data: row, error: null };
  });

  app.get('/api/studies/:studyId/layouts/:id', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const row = await queryOne(pool, `
      SELECT *
      FROM view_layouts
      WHERE study_id = $1 AND id = $2
    `, [params.studyId, params.id]);
    const widgets = await queryMany(pool, `SELECT * FROM widget_instances WHERE layout_id = $1 ORDER BY "order" ASC`, [params.id]);
    const data = layoutConfigSchema.parse({
      id: row?.id,
      studyId: row?.study_id,
      name: row?.name,
      type: row?.type,
      targetDisplay: row?.target_display ?? '0',
      zones: row?.layout_config?.zones ?? [],
      widgets: widgets.map((widget) => ({
        id: widget.id,
        widgetId: widget.widget_id,
        zoneId: widget.zone_id,
        order: widget.order,
        bindingsConfig: widget.bindings_config,
        triggerRules: widget.trigger_rules,
        styleOverrides: widget.style_overrides
      }))
    });
    return { success: true, data, error: null };
  });

  app.put('/api/studies/:studyId/layouts/:id', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), id: z.string().uuid() }).parse(request.params);
    const payload = layoutConfigSchema.omit({ id: true, studyId: true }).parse({
      ...(request.body as Record<string, unknown>),
      id: params.id,
      studyId: params.studyId
    });

    const row = await queryOne(pool, `
      UPDATE view_layouts
      SET name = $3,
          type = $4,
          target_display = $5,
          layout_config = $6::jsonb,
          updated_at = NOW()
      WHERE study_id = $1 AND id = $2
      RETURNING *
    `, [params.studyId, params.id, payload.name, payload.type, payload.targetDisplay, JSON.stringify({ zones: payload.zones })]);

    await pool.query(`DELETE FROM widget_instances WHERE layout_id = $1`, [params.id]);
    for (const widget of payload.widgets) {
      await pool.query(
        `INSERT INTO widget_instances (id, layout_id, widget_id, zone_id, "order", bindings_config, trigger_rules, style_overrides)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
        [
          widget.id,
          params.id,
          widget.widgetId,
          widget.zoneId,
          widget.order,
          JSON.stringify(widget.bindingsConfig),
          JSON.stringify(widget.triggerRules),
          JSON.stringify(widget.styleOverrides)
        ]
      );
    }

    return { success: true, data: row, error: null };
  });

  app.get('/api/widgets/catalogue', async () => {
    const data = await loadWidgetCatalogue(config.WIDGETS_DIR);
    return { success: true, data, error: null };
  });

  app.post('/api/studies/:studyId/sessions/:sessionId/triggers', async (request) => {
    const params = z.object({ studyId: z.string().uuid(), sessionId: z.string().uuid() }).parse(request.params);
    const payload = z.object({
      instanceId: z.string().uuid(),
      widgetId: z.string(),
      triggerType: z.enum(['manual', 'automatic', 'configurable']).default('manual'),
      source: z.enum(['researcher-trigger', 'rule-engine']).default('researcher-trigger'),
      operatorId: z.string().uuid().optional(),
      bindingValues: z.record(z.string(), z.unknown()).default({}),
      payload: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});

    const data = await rabbit.publishAndWait(makeCommandRoutingKey('widget', 'trigger'), payload, {
      studyId: params.studyId,
      runId: params.sessionId
    });

    return { success: true, data, error: null };
  });

  app.get('/api/sensors/status', async () => ({
    success: true,
    data: await queryMany(
      pool,
      `SELECT id, name, type, status, status_message, metadata, last_seen_at, updated_at
       FROM devices
       WHERE type IN ('steering_wheel', 'camera', 'eye_tracker', 'heart_rate')
       ORDER BY updated_at DESC`
    ),
    error: null
  }));

  app.get('/api/overlay/assets', async () => ({
    success: true,
    data: await scanWidgetsDir(config),
    error: null
  }));

  await registerPrdRoutes(app, {
    config,
    pool,
    rabbit,
    wsHub,
    components
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    const query = z.object({ token: z.string().min(1) }).safeParse(request.query);
    if (!query.success) {
      socket.send(JSON.stringify({ type: 'error', channel: 'system.health', data: { message: 'Missing token' } }));
      socket.close();
      return;
    }

    try {
      const claims = verifyAccessToken(query.data.token, config);
      const client = wsHub.register(socket as never, String(claims.sub));
      socket.on('message', (raw: Buffer) => {
        try {
          const message = websocketSubscriptionMessageSchema.parse(JSON.parse(raw.toString()));
          wsHub.updateSubscriptions(client, message.action, message.channels);
        } catch {
          socket.send(JSON.stringify({ type: 'error', channel: 'system.health', data: { message: 'Invalid subscription payload' } }));
        }
      });
    } catch {
      socket.send(JSON.stringify({ type: 'error', channel: 'system.health', data: { message: 'Unauthorized' } }));
      socket.close();
    }
  });
}

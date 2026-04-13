import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  exportJobSchema,
  researcherSchema,
  sessionLogEntrySchema,
  sessionSummarySchema,
  triggerRuleSchema,
  userAdminSchema
} from '@scarline/contracts';
import type { CoreApiConfig } from './config.js';
import type { RabbitManager } from './rabbit.js';
import type { WebSocketHub } from './websocket-hub.js';
import type { ComponentRegistry } from './component-status.js';
import { hashPassword } from './auth.js';
import { queryMany, queryOne } from './data.js';

interface Dependencies {
  config: CoreApiConfig;
  pool: Pool;
  rabbit: RabbitManager;
  wsHub: WebSocketHub;
  components: ComponentRegistry;
}

const uuidParamSchema = z.object({ id: z.string().uuid() });
const studyParamSchema = z.object({ studyId: z.string().uuid() });
const studyEntityParamSchema = z.object({ studyId: z.string().uuid(), id: z.string().uuid() });
const activeExportJobs = new Set<string>();

type ExportJobRow = {
  id: string;
  study_id: string | null;
  session_id: string | null;
  format: 'json' | 'csv' | 'zip';
  scope: 'study' | 'session' | 'all';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result_path: string | null;
  result_size_bytes?: number | null;
  error_message: string | null;
  parameters?: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
};

function ok<T>(data: T) {
  return { success: true, data, error: null };
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  reply.code(status);
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

function sqlLike(value: string): string {
  return `%${value.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function firstQueryValue(value: unknown): string | undefined {
  return Array.isArray(value) ? String(value[0]) : typeof value === 'string' ? value : undefined;
}

async function callProcessManager(
  socketPath: string,
  method: 'GET' | 'POST',
  path: string,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const encoded = method === 'POST' ? JSON.stringify(body) : '';

  return new Promise((resolve, reject) => {
    const requestOptions = socketPath.startsWith('http://')
      ? (() => {
          const target = new URL(path, socketPath.endsWith('/') ? socketPath : `${socketPath}/`);
          return {
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method,
            headers: method === 'POST'
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(encoded)
                }
              : undefined
          };
        })()
      : {
          socketPath,
          path,
          method,
          headers: method === 'POST'
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(encoded)
              }
            : undefined
        };
    const request = httpRequest(
      requestOptions,
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const payload = raw ? JSON.parse(raw) : {};
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(String(payload.error ?? `Process Manager returned ${response.statusCode}`)));
            return;
          }

          resolve(payload);
        });
      }
    );

    request.on('error', reject);
    if (encoded) {
      request.write(encoded);
    }
    request.end();
  });
}

async function findStudyOr404(pool: Pool, reply: FastifyReply, studyId: string) {
  const study = await queryOne(pool, `SELECT id FROM studies WHERE id = $1`, [studyId]);
  if (!study) {
    return fail(reply, 404, 'NOT_FOUND', 'Study not found');
  }

  return null;
}

async function listUsers(pool: Pool, where = '', values: unknown[] = []) {
  return queryMany(pool, `
    SELECT users.id,
           users.researcher_id,
           users.username,
           users.display_name,
           users.email,
           users.is_active,
           users.created_at,
           users.updated_at,
           ARRAY_REMOVE(ARRAY_AGG(roles.name), NULL) AS roles
    FROM users
    LEFT JOIN user_roles ON user_roles.user_id = users.id
    LEFT JOIN roles ON roles.id = user_roles.role_id
    ${where}
    GROUP BY users.id
    ORDER BY users.created_at DESC
  `, values);
}

async function replaceUserRoles(pool: Pool, userId: string, roles: string[]) {
  await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  for (const role of roles) {
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2
       ON CONFLICT DO NOTHING`,
      [userId, role]
    );
  }
}

async function duplicateStudy(pool: Pool, sourceStudyId: string, name?: string | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query(`SELECT * FROM studies WHERE id = $1`, [sourceStudyId]);
    if (source.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }

    const newStudyId = randomUUID();
    const newStudy = await client.query(
      `INSERT INTO studies (id, name, description, version, status, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING *`,
      [
        newStudyId,
        name ?? `Copy of ${source.rows[0].name}`,
        source.rows[0].description,
        source.rows[0].version,
        source.rows[0].created_by
      ]
    );

    await client.query(
      `INSERT INTO study_researchers (study_id, researcher_id, role)
       SELECT $1, researcher_id, role FROM study_researchers WHERE study_id = $2`,
      [newStudyId, sourceStudyId]
    );
    await client.query(
      `INSERT INTO carla_configurations (
         study_id, map, weather_preset, weather_custom, ego_vehicle_blueprint,
         simulation_mode, fixed_delta_seconds, traffic_config, pedestrian_config,
         sun_config, spectator_config, recording_config, sensors
       )
       SELECT $1, map, weather_preset, weather_custom, ego_vehicle_blueprint,
              simulation_mode, fixed_delta_seconds, traffic_config, pedestrian_config,
              sun_config, spectator_config, recording_config, sensors
       FROM carla_configurations WHERE study_id = $2`,
      [newStudyId, sourceStudyId]
    );
    await client.query(
      `INSERT INTO sensor_configurations (study_id, sensors)
       SELECT $1, sensors FROM sensor_configurations WHERE study_id = $2`,
      [newStudyId, sourceStudyId]
    );
    await client.query(
      `INSERT INTO conditions (study_id, name, description, "order", carla_overrides, widget_overrides)
       SELECT $1, name, description, "order", carla_overrides, widget_overrides
       FROM conditions WHERE study_id = $2`,
      [newStudyId, sourceStudyId]
    );

    const layouts = await client.query(`SELECT * FROM view_layouts WHERE study_id = $1`, [sourceStudyId]);
    for (const layout of layouts.rows) {
      const layoutId = randomUUID();
      await client.query(
        `INSERT INTO view_layouts (id, study_id, name, type, target_display, layout_config)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [layoutId, newStudyId, layout.name, layout.type, layout.target_display, JSON.stringify(layout.layout_config)]
      );
      await client.query(
        `INSERT INTO widget_instances (layout_id, widget_id, zone_id, "order", bindings_config, trigger_rules, style_overrides)
         SELECT $1, widget_id, zone_id, "order", bindings_config, trigger_rules, style_overrides
         FROM widget_instances WHERE layout_id = $2`,
        [layoutId, layout.id]
      );
    }

    await client.query('COMMIT');
    return newStudy.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function exportCsv(rows: Array<Record<string, unknown>>): string {
  const header = ['id', 'timestamp', 'event_type', 'modality', 'source', 'routing_key', 'payload'];
  const escape = (value: unknown) => `"${String(typeof value === 'object' ? JSON.stringify(value) : value ?? '').replaceAll('"', '""')}"`;
  return [header.join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))].join('\n');
}

function exportJobDto(row: ExportJobRow) {
  return exportJobSchema.parse({
    id: row.id,
    studyId: row.study_id,
    sessionId: row.session_id,
    format: row.format,
    scope: row.scope,
    status: row.status,
    progress: Number(row.progress ?? 0),
    resultPath: row.result_path,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString?.() ?? null
  });
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + content.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, end]);
}

async function assertExportNotCancelled(pool: Pool, jobId: string) {
  const row = await queryOne<{ status: string }>(pool, `SELECT status FROM export_jobs WHERE id = $1`, [jobId]);
  if (!row || row.status === 'cancelled') {
    throw new Error('EXPORT_CANCELLED');
  }
}

async function updateExportProgress(pool: Pool, wsHub: WebSocketHub, jobId: string, status: string, progress: number, extra: Record<string, unknown> = {}) {
  await pool.query(
    `UPDATE export_jobs
     SET status = $2, progress = $3, updated_at = NOW()
     WHERE id = $1 AND status <> 'cancelled'`,
    [jobId, status, progress]
  );
  wsHub.broadcast('export.progress', {
    exportJobId: jobId,
    status,
    progress,
    ...extra
  });
}

async function collectExportData(pool: Pool, job: ExportJobRow) {
  const filters = [job.study_id, job.session_id];
  const events = await queryMany(pool, `
    SELECT * FROM session_events
    WHERE ($1::uuid IS NULL OR study_id = $1)
      AND ($2::uuid IS NULL OR session_id = $2)
    ORDER BY "timestamp" ASC
  `, filters);
  const studies = await queryMany(pool, `
    SELECT * FROM studies
    WHERE ($1::uuid IS NULL OR id = $1)
    ORDER BY created_at ASC
  `, [job.study_id]);
  const sessions = await queryMany(pool, `
    SELECT * FROM sessions
    WHERE ($1::uuid IS NULL OR study_id = $1)
      AND ($2::uuid IS NULL OR id = $2)
    ORDER BY created_at ASC
  `, filters);
  const participants = await queryMany(pool, `
    SELECT * FROM participants
    WHERE ($1::uuid IS NULL OR study_id = $1)
    ORDER BY created_at ASC
  `, [job.study_id]);
  const conditions = await queryMany(pool, `
    SELECT * FROM conditions
    WHERE ($1::uuid IS NULL OR study_id = $1)
    ORDER BY "order" ASC, created_at ASC
  `, [job.study_id]);

  return {
    exportJob: {
      id: job.id,
      studyId: job.study_id,
      sessionId: job.session_id,
      format: job.format,
      scope: job.scope,
      createdAt: job.created_at.toISOString()
    },
    generatedAt: new Date().toISOString(),
    studies,
    sessions,
    participants,
    conditions,
    events
  };
}

async function writeExportArtifact(exportDir: string, job: ExportJobRow, data: Awaited<ReturnType<typeof collectExportData>>) {
  await fs.mkdir(exportDir, { recursive: true });
  const extension = job.format;
  const filename = `scarline-export-${job.id}.${extension}`;
  const resultPath = path.join(exportDir, filename);
  let content: string | Buffer;

  if (job.format === 'csv') {
    content = exportCsv(data.events);
  } else if (job.format === 'zip') {
    content = createStoredZip([
      { name: 'manifest.json', content: JSON.stringify(data.exportJob, null, 2) },
      { name: 'studies.json', content: JSON.stringify(data.studies, null, 2) },
      { name: 'sessions.json', content: JSON.stringify(data.sessions, null, 2) },
      { name: 'participants.json', content: JSON.stringify(data.participants, null, 2) },
      { name: 'conditions.json', content: JSON.stringify(data.conditions, null, 2) },
      { name: 'events.json', content: JSON.stringify(data.events, null, 2) },
      { name: 'events.csv', content: exportCsv(data.events) }
    ]);
  } else {
    content = JSON.stringify(data, null, 2);
  }

  await fs.writeFile(resultPath, content);
  const stat = await fs.stat(resultPath);
  return {
    resultPath,
    resultSizeBytes: stat.size
  };
}

async function processExportJob(pool: Pool, wsHub: WebSocketHub, exportDir: string, jobId: string) {
  if (activeExportJobs.has(jobId)) {
    return;
  }
  activeExportJobs.add(jobId);
  try {
    const claimed = await queryOne<ExportJobRow>(pool, `
      UPDATE export_jobs
      SET status = 'running', progress = 5, started_at = COALESCE(started_at, NOW()), error_message = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING *
    `, [jobId]);
    if (!claimed) {
      return;
    }

    wsHub.broadcast('export.progress', { exportJobId: jobId, status: 'running', progress: 5 });
    await assertExportNotCancelled(pool, jobId);
    await updateExportProgress(pool, wsHub, jobId, 'running', 25);
    const data = await collectExportData(pool, claimed);
    await assertExportNotCancelled(pool, jobId);
    await updateExportProgress(pool, wsHub, jobId, 'running', 70);
    const artifact = await writeExportArtifact(exportDir, claimed, data);
    await assertExportNotCancelled(pool, jobId);
    await pool.query(
      `UPDATE export_jobs
       SET status = 'completed',
           progress = 100,
           result_path = $2,
           result_size_bytes = $3,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status <> 'cancelled'`,
      [jobId, artifact.resultPath, artifact.resultSizeBytes]
    );
    wsHub.broadcast('export.progress', {
      exportJobId: jobId,
      status: 'completed',
      progress: 100,
      resultPath: artifact.resultPath,
      resultSizeBytes: artifact.resultSizeBytes
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'EXPORT_CANCELLED') {
      wsHub.broadcast('export.progress', { exportJobId: jobId, status: 'cancelled', progress: 0 });
      return;
    }

    const message = error instanceof Error ? error.message : 'Export failed';
    await pool.query(
      `UPDATE export_jobs
       SET status = 'failed', error_message = $2, updated_at = NOW(), completed_at = NOW()
       WHERE id = $1 AND status <> 'cancelled'`,
      [jobId, message]
    );
    wsHub.broadcast('export.progress', { exportJobId: jobId, status: 'failed', progress: 0, errorMessage: message });
  } finally {
    activeExportJobs.delete(jobId);
  }
}

async function resumeExportJobs(pool: Pool, wsHub: WebSocketHub, exportDir: string) {
  const rows = await queryMany<{ id: string }>(pool, `
    UPDATE export_jobs
    SET status = 'queued', progress = 0, updated_at = NOW()
    WHERE status = 'running'
    RETURNING id
  `);
  const queued = await queryMany<{ id: string }>(pool, `SELECT id FROM export_jobs WHERE status = 'queued' ORDER BY created_at ASC`);
  for (const row of [...rows, ...queued]) {
    setImmediate(() => {
      void processExportJob(pool, wsHub, exportDir, row.id);
    });
  }
}

export async function registerPrdRoutes(app: FastifyInstance, deps: Dependencies): Promise<void> {
  const { config, pool, wsHub } = deps;

  app.get('/api/researchers', async (request) => {
    const query = z.object({
      search: z.string().optional()
    }).parse(request.query ?? {});
    const where = query.search ? `WHERE name ILIKE $1 OR email ILIKE $1 OR institution ILIKE $1` : '';
    const values = query.search ? [sqlLike(query.search)] : [];
    const rows = await queryMany(pool, `
      SELECT researchers.*,
             COUNT(DISTINCT study_researchers.study_id)::int AS active_studies_count
      FROM researchers
      LEFT JOIN study_researchers ON study_researchers.researcher_id = researchers.id
      ${where}
      GROUP BY researchers.id
      ORDER BY researchers.created_at DESC
    `, values);
    return ok(rows.map((row) => researcherSchema.parse({
      id: row.id,
      name: row.name,
      institution: row.institution,
      role: row.role,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      customFields: row.custom_fields ?? {},
      activeStudiesCount: Number(row.active_studies_count ?? 0),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    })));
  });

  app.post('/api/researchers', async (request) => {
    const payload = z.object({
      name: z.string().min(1),
      institution: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      customFields: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      INSERT INTO researchers (name, institution, role, email, phone, notes, custom_fields)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *
    `, [payload.name, payload.institution ?? null, payload.role ?? null, payload.email ?? null, payload.phone ?? null, payload.notes ?? null, JSON.stringify(payload.customFields)]);
    return ok(row);
  });

  app.get('/api/researchers/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `
      SELECT researchers.*,
             COUNT(DISTINCT study_researchers.study_id)::int AS active_studies_count
      FROM researchers
      LEFT JOIN study_researchers ON study_researchers.researcher_id = researchers.id
      WHERE researchers.id = $1
      GROUP BY researchers.id
    `, [params.id]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Researcher not found');
  });

  app.put('/api/researchers/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      institution: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      customFields: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE researchers
      SET name = $2, institution = $3, role = $4, email = $5, phone = $6,
          notes = $7, custom_fields = $8::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [params.id, payload.name, payload.institution ?? null, payload.role ?? null, payload.email ?? null, payload.phone ?? null, payload.notes ?? null, JSON.stringify(payload.customFields)]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Researcher not found');
  });

  app.delete('/api/researchers/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `DELETE FROM researchers WHERE id = $1 RETURNING id`, [params.id]);
    return row ? ok({ deleted: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'Researcher not found');
  });

  app.get('/api/researchers/:id/studies', async (request) => {
    const params = uuidParamSchema.parse(request.params);
    const rows = await queryMany(pool, `
      SELECT studies.*, study_researchers.role AS assignment_role
      FROM study_researchers
      JOIN studies ON studies.id = study_researchers.study_id
      WHERE study_researchers.researcher_id = $1
      ORDER BY studies.updated_at DESC
    `, [params.id]);
    return ok(rows);
  });

  app.delete('/api/studies/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `DELETE FROM studies WHERE id = $1 RETURNING id`, [params.id]);
    return row ? ok({ deleted: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'Study not found');
  });

  app.post('/api/studies/:id/duplicate', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const payload = z.object({ name: z.string().min(1).nullable().optional() }).parse(request.body ?? {});
    const row = await duplicateStudy(pool, params.id, payload.name);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Study not found');
  });

  app.get('/api/studies/:studyId/conditions/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const row = await queryOne(pool, `SELECT * FROM conditions WHERE study_id = $1 AND id = $2`, [params.studyId, params.id]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Condition not found');
  });

  app.delete('/api/studies/:studyId/conditions/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const row = await queryOne(pool, `DELETE FROM conditions WHERE study_id = $1 AND id = $2 RETURNING id`, [params.studyId, params.id]);
    return row ? ok({ deleted: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'Condition not found');
  });

  app.get('/api/studies/:studyId/participants/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const row = await queryOne(pool, `SELECT * FROM participants WHERE study_id = $1 AND id = $2`, [params.studyId, params.id]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Participant not found');
  });

  app.delete('/api/studies/:studyId/participants/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const row = await queryOne(pool, `DELETE FROM participants WHERE study_id = $1 AND id = $2 RETURNING id`, [params.studyId, params.id]);
    return row ? ok({ deleted: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'Participant not found');
  });

  app.put('/api/studies/:studyId/sessions/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const payload = z.object({
      participantId: z.string().uuid().nullable().optional(),
      conditionId: z.string().uuid().nullable().optional(),
      name: z.string().nullable().optional(),
      notes: z.string().nullable().optional()
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE sessions
      SET participant_id = $3, condition_id = $4, name = $5, notes = $6, updated_at = NOW()
      WHERE study_id = $1 AND id = $2
      RETURNING *
    `, [params.studyId, params.id, payload.participantId ?? null, payload.conditionId ?? null, payload.name ?? null, payload.notes ?? null]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Session not found');
  });

  app.delete('/api/studies/:studyId/sessions/:id', async (request, reply) => {
    const params = studyEntityParamSchema.parse(request.params);
    const current = await queryOne<{ status: string }>(pool, `SELECT status FROM sessions WHERE study_id = $1 AND id = $2`, [params.studyId, params.id]);
    if (!current) {
      return fail(reply, 404, 'NOT_FOUND', 'Session not found');
    }
    if (['running', 'paused'].includes(current.status)) {
      return fail(reply, 409, 'STATE_CONFLICT', 'Running or paused sessions cannot be deleted');
    }
    await pool.query(`DELETE FROM sessions WHERE study_id = $1 AND id = $2`, [params.studyId, params.id]);
    return ok({ deleted: true, id: params.id });
  });

  app.post('/api/carla/test-connection', async (request) => {
    const payload = z.object({
      host: z.string().default('host.docker.internal'),
      port: z.number().int().positive().default(2000)
    }).parse(request.body ?? {});
    try {
      const pmStatus = await callProcessManager(config.PM_SOCKET_PATH, 'GET', '/carla/status');
      return ok({ reachable: pmStatus.status === 'running', host: payload.host, port: payload.port, processManager: pmStatus });
    } catch (error) {
      return ok({ reachable: false, host: payload.host, port: payload.port, message: error instanceof Error ? error.message : 'Process Manager unavailable' });
    }
  });

  app.get('/api/studies/:studyId/trigger-rules', async (request, reply) => {
    const params = studyParamSchema.parse(request.params);
    const notFound = await findStudyOr404(pool, reply, params.studyId);
    if (notFound) return notFound;
    const rows = await queryMany(pool, `SELECT * FROM study_trigger_rules WHERE study_id = $1 ORDER BY priority ASC, created_at ASC`, [params.studyId]);
    return ok(rows.map((row) => triggerRuleSchema.parse({
      id: row.id,
      studyId: row.study_id,
      conditionId: row.condition_id,
      name: row.name,
      widgetId: row.widget_id,
      instanceId: row.instance_id,
      condition: row.rule_condition,
      action: row.action,
      bindingOverrides: row.binding_overrides,
      enabled: row.enabled,
      priority: row.priority,
      cooldownMs: row.cooldown_ms,
      lastTriggeredAt: row.last_triggered_at?.toISOString?.() ?? null
    })));
  });

  app.put('/api/studies/:studyId/trigger-rules', async (request, reply) => {
    const params = studyParamSchema.parse(request.params);
    const notFound = await findStudyOr404(pool, reply, params.studyId);
    if (notFound) return notFound;
    const payload = z.object({
      rules: z.array(z.object({
        id: z.string().uuid().optional(),
        conditionId: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        widgetId: z.string().min(1),
        instanceId: z.string().uuid().nullable().optional(),
        condition: z.string().min(1),
        action: z.string().min(1),
        bindingOverrides: z.record(z.string(), z.unknown()).default({}),
        enabled: z.boolean().default(true),
        priority: z.number().int().default(100),
        cooldownMs: z.number().int().nonnegative().default(0)
      })).default([])
    }).parse(request.body ?? {});

    await pool.query(`DELETE FROM study_trigger_rules WHERE study_id = $1`, [params.studyId]);
    for (const rule of payload.rules) {
      await pool.query(
        `INSERT INTO study_trigger_rules (
           id, study_id, condition_id, name, widget_id, instance_id, rule_condition,
           action, binding_overrides, enabled, priority, cooldown_ms
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
        [
          rule.id ?? randomUUID(),
          params.studyId,
          rule.conditionId ?? null,
          rule.name,
          rule.widgetId,
          rule.instanceId ?? null,
          rule.condition,
          rule.action,
          JSON.stringify(rule.bindingOverrides),
          rule.enabled,
          rule.priority,
          rule.cooldownMs
        ]
      );
    }

    const rows = await queryMany(pool, `SELECT * FROM study_trigger_rules WHERE study_id = $1 ORDER BY priority ASC, created_at ASC`, [params.studyId]);
    return ok(rows);
  });

  app.get('/api/devices', async (request) => {
    const query = z.object({
      type: z.string().optional(),
      status: z.string().optional()
    }).parse(request.query ?? {});
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.type) {
      values.push(query.type);
      clauses.push(`type = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      clauses.push(`status = $${values.length}`);
    }
    const rows = await queryMany(pool, `SELECT * FROM devices ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC`, values);
    return ok(rows);
  });

  app.post('/api/devices', async (request) => {
    const payload = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      status: z.string().default('disconnected'),
      configuration: z.record(z.string(), z.unknown()).default({}),
      displayConfiguration: z.record(z.string(), z.unknown()).default({}),
      metadata: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      INSERT INTO devices (name, type, status, configuration, display_configuration, metadata)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
      RETURNING *
    `, [payload.name, payload.type, payload.status, JSON.stringify(payload.configuration), JSON.stringify(payload.displayConfiguration), JSON.stringify(payload.metadata)]);
    return ok(row);
  });

  app.put('/api/devices/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const payload = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      status: z.string().default('disconnected'),
      configuration: z.record(z.string(), z.unknown()).default({}),
      displayConfiguration: z.record(z.string(), z.unknown()).default({}),
      metadata: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne(pool, `
      UPDATE devices
      SET name = $2, type = $3, status = $4, configuration = $5::jsonb,
          display_configuration = $6::jsonb, metadata = $7::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [params.id, payload.name, payload.type, payload.status, JSON.stringify(payload.configuration), JSON.stringify(payload.displayConfiguration), JSON.stringify(payload.metadata)]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Device not found');
  });

  app.delete('/api/devices/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `DELETE FROM devices WHERE id = $1 RETURNING id`, [params.id]);
    return row ? ok({ deleted: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'Device not found');
  });

  app.get('/api/devices/:id/status', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `SELECT id, name, type, status, status_message, last_seen_at, metadata FROM devices WHERE id = $1`, [params.id]);
    return row ? ok(row) : fail(reply, 404, 'NOT_FOUND', 'Device not found');
  });

  app.get('/api/users', async () => {
    const rows = await listUsers(pool);
    return ok(rows.map((row) => userAdminSchema.parse({
      id: row.id,
      researcherId: row.researcher_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      isActive: row.is_active,
      roles: row.roles ?? [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    })));
  });

  app.post('/api/users', async (request) => {
    const payload = z.object({
      researcherId: z.string().uuid().nullable().optional(),
      username: z.string().min(1),
      password: z.string().min(8),
      displayName: z.string().min(1),
      email: z.string().email().nullable().optional(),
      roles: z.array(z.enum(['admin', 'researcher', 'operator', 'viewer'])).min(1).default(['viewer'])
    }).parse(request.body ?? {});
    const passwordHash = await hashPassword(payload.password);
    const user = await queryOne(pool, `
      INSERT INTO users (researcher_id, username, password_hash, display_name, email)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [payload.researcherId ?? null, payload.username, passwordHash, payload.displayName, payload.email ?? null]);
    if (user) {
      await replaceUserRoles(pool, user.id, payload.roles);
    }
    return ok(user);
  });

  app.get('/api/users/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const rows = await listUsers(pool, `WHERE users.id = $1`, [params.id]);
    return rows[0] ? ok(rows[0]) : fail(reply, 404, 'NOT_FOUND', 'User not found');
  });

  app.put('/api/users/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const payload = z.object({
      researcherId: z.string().uuid().nullable().optional(),
      displayName: z.string().min(1),
      email: z.string().email().nullable().optional(),
      isActive: z.boolean().default(true),
      password: z.string().min(8).optional(),
      roles: z.array(z.enum(['admin', 'researcher', 'operator', 'viewer'])).min(1).optional()
    }).parse(request.body ?? {});
    const passwordHash = payload.password ? await hashPassword(payload.password) : null;
    const row = await queryOne(pool, `
      UPDATE users
      SET researcher_id = $2,
          display_name = $3,
          email = $4,
          is_active = $5,
          password_hash = COALESCE($6, password_hash),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [params.id, payload.researcherId ?? null, payload.displayName, payload.email ?? null, payload.isActive, passwordHash]);
    if (!row) {
      return fail(reply, 404, 'NOT_FOUND', 'User not found');
    }
    if (payload.roles) {
      await replaceUserRoles(pool, params.id, payload.roles);
    }
    return ok(row);
  });

  app.delete('/api/users/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne(pool, `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`, [params.id]);
    return row ? ok({ deactivated: true, id: params.id }) : fail(reply, 404, 'NOT_FOUND', 'User not found');
  });

  app.get('/api/exports', async (request) => {
    const query = z.object({
      studyId: z.string().uuid().optional(),
      sessionId: z.string().uuid().optional(),
      status: z.string().optional()
    }).parse(request.query ?? {});
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.studyId) {
      values.push(query.studyId);
      clauses.push(`study_id = $${values.length}`);
    }
    if (query.sessionId) {
      values.push(query.sessionId);
      clauses.push(`session_id = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      clauses.push(`status = $${values.length}`);
    }
    const rows = await queryMany<ExportJobRow>(pool, `SELECT * FROM export_jobs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC`, values);
    return ok(rows.map(exportJobDto));
  });

  app.post('/api/exports', async (request) => {
    const payload = z.object({
      studyId: z.string().uuid().nullable().optional(),
      sessionId: z.string().uuid().nullable().optional(),
      format: z.enum(['json', 'csv', 'zip']).default('json'),
      scope: z.enum(['study', 'session', 'all']).default('session'),
      parameters: z.record(z.string(), z.unknown()).default({})
    }).parse(request.body ?? {});
    const row = await queryOne<ExportJobRow>(pool, `
      INSERT INTO export_jobs (study_id, session_id, format, scope, status, progress, parameters)
      VALUES ($1, $2, $3, $4, 'queued', 0, $5::jsonb)
      RETURNING *
    `, [payload.studyId ?? null, payload.sessionId ?? null, payload.format, payload.scope, JSON.stringify(payload.parameters)]);
    wsHub.broadcast('export.progress', {
      exportJobId: row?.id,
      status: 'queued',
      progress: 0
    });
    if (row) {
      setImmediate(() => {
        void processExportJob(pool, wsHub, config.EXPORTS_DIR, row.id);
      });
    }
    return ok(row ? exportJobDto(row) : null);
  });

  app.get('/api/exports/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const row = await queryOne<ExportJobRow>(pool, `SELECT * FROM export_jobs WHERE id = $1`, [params.id]);
    return row ? ok(exportJobDto(row)) : fail(reply, 404, 'NOT_FOUND', 'Export job not found');
  });

  app.get('/api/exports/:id/download', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const job = await queryOne<ExportJobRow>(pool, `SELECT * FROM export_jobs WHERE id = $1`, [params.id]);
    if (!job) {
      return fail(reply, 404, 'NOT_FOUND', 'Export job not found');
    }
    if (job.status !== 'completed' || !job.result_path) {
      return fail(reply, 409, 'EXPORT_NOT_READY', `Export is ${job.status}`);
    }

    const resolvedExportDir = path.resolve(config.EXPORTS_DIR);
    const resolvedArtifact = path.resolve(job.result_path);
    if (!resolvedArtifact.startsWith(`${resolvedExportDir}${path.sep}`)) {
      return fail(reply, 500, 'INVALID_EXPORT_PATH', 'Export artifact path is outside the configured export directory');
    }

    let artifact: Buffer;
    try {
      artifact = await fs.readFile(resolvedArtifact);
    } catch {
      return fail(reply, 410, 'EXPORT_ARTIFACT_MISSING', 'Export artifact is no longer available');
    }

    if (job.format === 'csv') {
      reply.header('content-type', 'text/csv');
      reply.header('content-disposition', `attachment; filename="scarline-export-${params.id}.csv"`);
      return artifact;
    }
    if (job.format === 'zip') {
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="scarline-export-${params.id}.zip"`);
      return artifact;
    }
    reply.header('content-type', 'application/json');
    reply.header('content-disposition', `attachment; filename="scarline-export-${params.id}.json"`);
    return artifact;
  });

  app.delete('/api/exports/:id', async (request, reply) => {
    const params = uuidParamSchema.parse(request.params);
    const current = await queryOne<ExportJobRow>(pool, `SELECT * FROM export_jobs WHERE id = $1`, [params.id]);
    if (!current) {
      return fail(reply, 404, 'NOT_FOUND', 'Export job not found');
    }
    if (current.status === 'queued' || current.status === 'running') {
      await pool.query(
        `UPDATE export_jobs
         SET status = 'cancelled', progress = 0, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [params.id]
      );
      wsHub.broadcast('export.progress', { exportJobId: params.id, status: 'cancelled', progress: 0 });
      return ok({ cancelled: true, id: params.id });
    }

    await pool.query(`DELETE FROM export_jobs WHERE id = $1`, [params.id]);
    if (current.result_path) {
      const resolvedExportDir = path.resolve(config.EXPORTS_DIR);
      const resolvedArtifact = path.resolve(current.result_path);
      if (resolvedArtifact.startsWith(`${resolvedExportDir}${path.sep}`)) {
        await fs.unlink(resolvedArtifact).catch(() => undefined);
      }
    }
    return ok({ deleted: true, id: params.id });
  });

  app.get('/api/session-logs', async (request) => {
    const query = z.object({
      studyId: z.string().uuid().optional(),
      sessionId: z.string().uuid().optional(),
      eventType: z.string().optional(),
      modality: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).default(100),
      offset: z.coerce.number().int().nonnegative().default(0)
    }).parse(request.query ?? {});
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.studyId) {
      values.push(query.studyId);
      clauses.push(`study_id = $${values.length}`);
    }
    if (query.sessionId) {
      values.push(query.sessionId);
      clauses.push(`session_id = $${values.length}`);
    }
    if (query.eventType) {
      values.push(query.eventType);
      clauses.push(`event_type = $${values.length}`);
    }
    if (query.modality) {
      values.push(query.modality);
      clauses.push(`modality = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const rows = await queryMany(pool, `
      SELECT * FROM session_events
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY "timestamp" DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    return ok(rows.map((row) => sessionLogEntrySchema.parse({
      id: Number(row.id),
      sessionId: row.session_id,
      studyId: row.study_id,
      timestamp: row.timestamp.toISOString(),
      eventType: row.event_type,
      modality: row.modality,
      source: row.source,
      routingKey: row.routing_key,
      payload: row.payload
    })));
  });

  app.get('/api/session-logs/:sessionId', async (request) => {
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const query = z.object({
      limit: z.coerce.number().int().positive().max(1000).default(500),
      offset: z.coerce.number().int().nonnegative().default(0)
    }).parse(request.query ?? {});
    const rows = await queryMany(pool, `
      SELECT * FROM session_events
      WHERE session_id = $1
      ORDER BY "timestamp" ASC
      LIMIT $2 OFFSET $3
    `, [params.sessionId, query.limit, query.offset]);
    return ok(rows);
  });

  app.get('/api/session-logs/:sessionId/summary', async (request, reply) => {
    const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const row = await queryOne(pool, `
      SELECT sessions.id AS session_id,
             sessions.study_id,
             sessions.status,
             COUNT(session_events.id)::int AS event_count,
             COUNT(DISTINCT session_events.modality)::int AS modality_count,
             MIN(session_events.timestamp) AS first_event_at,
             MAX(session_events.timestamp) AS last_event_at,
             sessions.duration_seconds
      FROM sessions
      LEFT JOIN session_events ON session_events.session_id = sessions.id
      WHERE sessions.id = $1
      GROUP BY sessions.id
    `, [params.sessionId]);
    return row ? ok(sessionSummarySchema.parse({
      sessionId: row.session_id,
      studyId: row.study_id,
      status: row.status,
      eventCount: Number(row.event_count ?? 0),
      modalityCount: Number(row.modality_count ?? 0),
      firstEventAt: row.first_event_at?.toISOString?.() ?? null,
      lastEventAt: row.last_event_at?.toISOString?.() ?? null,
      durationSeconds: row.duration_seconds
    })) : fail(reply, 404, 'NOT_FOUND', 'Session not found');
  });

  app.get('/api/system/process-manager/status', async (request, reply) => {
    try {
      return ok(await callProcessManager(config.PM_SOCKET_PATH, 'GET', '/status'));
    } catch (error) {
      return fail(reply, 503, 'PROCESS_MANAGER_UNAVAILABLE', error instanceof Error ? error.message : 'Process Manager unavailable');
    }
  });

  app.post('/api/system/carla/:action', async (request, reply) => {
    const params = z.object({ action: z.enum(['start', 'stop', 'restart']) }).parse(request.params);
    try {
      return ok(await callProcessManager(config.PM_SOCKET_PATH, 'POST', `/carla/${params.action}`));
    } catch (error) {
      return fail(reply, 503, 'PROCESS_MANAGER_UNAVAILABLE', error instanceof Error ? error.message : 'Process Manager unavailable');
    }
  });

  app.post('/api/system/overlay/reload', async (_request, reply) => {
    try {
      return ok(await callProcessManager(config.PM_SOCKET_PATH, 'POST', '/overlay/reload'));
    } catch (error) {
      return fail(reply, 503, 'PROCESS_MANAGER_UNAVAILABLE', error instanceof Error ? error.message : 'Process Manager unavailable');
    }
  });

  app.post('/api/system/restart', async (_request, reply) => {
    try {
      return ok(await callProcessManager(config.PM_SOCKET_PATH, 'POST', '/restart'));
    } catch {
      return ok({ accepted: false, message: 'Restart command is not supported by this Process Manager yet' });
    }
  });

  await fs.mkdir(config.EXPORTS_DIR, { recursive: true });
  await resumeExportJobs(pool, wsHub, config.EXPORTS_DIR);
}

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";

import type { ManagedCoreApiService } from "../runtime.js";
import type { RealtimeHub } from "../realtime/hub.js";

interface ExportJob {
  id: string;
  study_id: string | null;
  participant_id: string | null;
  session_id: string | null;
  session_condition_id: string | null;
  format: "csv" | "json" | "both";
  scope: "study" | "participant" | "session" | "session_condition";
  parameters: { pseudonymize?: boolean; includeDemographics?: boolean };
}

export class ExportWorker implements ManagedCoreApiService {
  readonly #pool: Pool;
  readonly #directory: string;
  readonly #logger: FastifyBaseLogger;
  readonly #hub: RealtimeHub;
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(pool: Pool, directory: string, logger: FastifyBaseLogger, hub: RealtimeHub) {
    this.#pool = pool;
    this.#directory = directory;
    this.#logger = logger;
    this.#hub = hub;
  }

  async start(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await this.#pool.query("UPDATE export_jobs SET status='queued',progress=0,started_at=NULL WHERE status='running'");
    this.#timer = setInterval(() => void this.#poll(), 500);
    this.#timer.unref();
    void this.#poll();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #poll(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const claimed = await this.#pool.query<ExportJob>(
        `UPDATE export_jobs e SET status='running',progress=5,started_at=NOW()
         FROM (SELECT id FROM export_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) q
         WHERE e.id=q.id RETURNING e.*`,
      );
      const job = claimed.rows[0];
      if (job !== undefined) await this.#run(job);
    } catch (error) {
      this.#logger.error({ err: error }, "Export worker poll failed");
    } finally {
      this.#running = false;
    }
  }

  async #run(job: ExportJob): Promise<void> {
    const artifactPath = path.join(this.#directory, `${job.id}.zip`);
    try {
      const data = await this.#loadData(job);
      await this.#progress(job, 35);
      await writeArchive(artifactPath, data, job.format);
      const artifact = await stat(artifactPath);
      await this.#pool.query(
        `UPDATE export_jobs SET status='completed',progress=100,result_path=$2,result_size_bytes=$3,
         completed_at=NOW(),error_message=NULL WHERE id=$1`,
        [job.id, artifactPath, artifact.size],
      );
      this.#hub.broadcast("export.progress", {
        exportJobId: job.id, status: "completed", progress: 100, artifactPath, errorMessage: null,
      }, job.study_id, job.session_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#pool.query(
        "UPDATE export_jobs SET status='failed',error_message=$2,completed_at=NOW() WHERE id=$1",
        [job.id, message.slice(0, 2_000)],
      );
      this.#hub.broadcast("export.progress", {
        exportJobId: job.id, status: "failed", progress: 0, artifactPath: null, errorMessage: message,
      }, job.study_id, job.session_id);
    }
  }

  async #progress(job: ExportJob, progress: number): Promise<void> {
    await this.#pool.query("UPDATE export_jobs SET progress=$2 WHERE id=$1", [job.id, progress]);
    this.#hub.broadcast("export.progress", {
      exportJobId: job.id, status: "running", progress, artifactPath: null, errorMessage: null,
    }, job.study_id, job.session_id);
  }

  async #loadData(job: ExportJob): Promise<Record<string, Record<string, unknown>[]>> {
    const sessionFilter = job.scope === "session" ? job.session_id : null;
    const conditionFilter = job.scope === "session_condition" ? job.session_condition_id : null;
    const participantFilter = job.scope === "participant" ? job.participant_id : null;
    const studyResult = await this.#pool.query(
      `SELECT DISTINCT s.* FROM studies s
       LEFT JOIN sessions se ON se.study_id=s.id LEFT JOIN session_conditions sc ON sc.session_id=se.id
       WHERE ($1::uuid IS NOT NULL AND s.id=$1)
          OR ($2::uuid IS NOT NULL AND se.participant_id=$2)
          OR ($3::uuid IS NOT NULL AND se.id=$3)
          OR ($4::uuid IS NOT NULL AND sc.id=$4)`,
      [job.scope === "study" ? job.study_id : null, participantFilter, sessionFilter, conditionFilter],
    );
    const studyIds = studyResult.rows.map((row) => row.id as string);
    const sessions = await this.#pool.query(
      `SELECT se.* FROM sessions se LEFT JOIN session_conditions sc ON sc.session_id=se.id
       WHERE se.study_id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR se.participant_id=$2)
         AND ($3::uuid IS NULL OR se.id=$3) AND ($4::uuid IS NULL OR sc.id=$4)
       GROUP BY se.id ORDER BY se.created_at`, [studyIds, participantFilter, sessionFilter, conditionFilter],
    );
    const sessionIds = sessions.rows.map((row) => row.id as string);
    const sessionConditions = await this.#pool.query(
      `SELECT * FROM session_conditions WHERE session_id=ANY($1::uuid[])
       AND ($2::uuid IS NULL OR id=$2) ORDER BY session_id,sequence`, [sessionIds, conditionFilter],
    );
    const sessionConditionIds = sessionConditions.rows.map((row) => row.id as string);
    const [conditions, participants, events] = await Promise.all([
      this.#pool.query("SELECT * FROM conditions WHERE study_id=ANY($1::uuid[]) ORDER BY study_id,\"order\"", [studyIds]),
      this.#pool.query("SELECT * FROM participants WHERE study_id=ANY($1::uuid[]) ORDER BY study_id,created_at", [studyIds]),
      this.#pool.query(
        `SELECT * FROM session_events WHERE session_id=ANY($1::uuid[])
         AND ($2::uuid[]='{}'::uuid[] OR session_condition_id IS NULL OR session_condition_id=ANY($2::uuid[]))
         ORDER BY session_id,"timestamp"`, [sessionIds, sessionConditionIds],
      ),
    ]);
    const parameters = job.parameters ?? {};
    const participantAliases = new Map<string, string>();
    participants.rows.forEach((row, index) => participantAliases.set(row.id as string, `participant-${String(index + 1).padStart(3, "0")}`));
    const sanitizedParticipants = participants.rows.map((row) => ({
      id: row.id,
      study_id: row.study_id,
      participant_code: parameters.pseudonymize === false ? row.participant_code : participantAliases.get(row.id as string),
      ...(parameters.includeDemographics ? { demographic_data: row.demographic_data } : {}),
      created_at: row.created_at,
    }));
    const sanitizedStudies = studyResult.rows.map(({ created_by: _createdBy, ...row }) => row);
    const sanitizedSessions = sessions.rows.map(({ started_by_user_id: _startedBy, ...row }) => row);
    const sanitizedEvents = events.rows.map((row) => ({ ...row, payload: removeUserReferences(row.payload) }));
    return {
      studies: sanitizedStudies,
      conditions: conditions.rows,
      participants: sanitizedParticipants,
      sessions: sanitizedSessions,
      session_conditions: sessionConditions.rows,
      session_events: sanitizedEvents,
    };
  }
}

function removeUserReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUserReferences);
  if (value === null || typeof value !== "object") return value;
  const blocked = new Set(["createdBy", "requestedBy", "actorUserId", "startedByUserId"]);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.has(key))
      .map(([key, item]) => [key, removeUserReferences(item)]),
  );
}

async function writeArchive(
  artifactPath: string,
  data: Record<string, Record<string, unknown>[]>,
  format: "csv" | "json" | "both",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(artifactPath, { flags: "w" });
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const [name, rows] of Object.entries(data)) {
      if (format === "json" || format === "both") archive.append(JSON.stringify(rows, null, 2), { name: `${name}.json` });
      if (format === "csv" || format === "both") archive.append(toCsv(rows), { name: `${name}.csv` });
    }
    void archive.finalize();
  });
}

function toCsv(rows: Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const values = [headers, ...rows.map((row) => headers.map((header) => row[header]))];
  return `${values.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

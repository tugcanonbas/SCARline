import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  WidgetMetadataSchema,
  type WidgetMetadata,
} from "@scarline/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

import { recordActivity } from "../infrastructure/activity.js";

const WIDGET_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const CATALOGUE_LOCK = "scarline.widgets.catalogue";

export interface WidgetCatalogueEntry extends WidgetMetadata {
  readonly databaseId: string;
}

export interface WidgetCatalogueRefreshResult {
  readonly scanned: number;
  readonly created: number;
  readonly updated: number;
  readonly reactivated: number;
  readonly deactivated: number;
  readonly unchanged: number;
  readonly refreshedAt: string;
  readonly catalogue: readonly WidgetCatalogueEntry[];
}

export interface WidgetCatalogueIssue {
  readonly directory: string;
  readonly message: string;
}

export class WidgetCatalogueValidationError extends Error {
  readonly issues: readonly WidgetCatalogueIssue[];

  constructor(issues: readonly WidgetCatalogueIssue[]) {
    super(`Widget refresh rejected ${issues.length} invalid widget${issues.length === 1 ? "" : "s"}.`);
    this.name = "WidgetCatalogueValidationError";
    this.issues = issues;
  }
}

interface WidgetRow {
  readonly id: string;
  readonly key: string;
  readonly version: string;
  readonly name: string;
  readonly description: string | null;
  readonly metadata: unknown;
  readonly is_active: boolean;
}

export class WidgetCatalogueService {
  readonly #pool: Pool;
  readonly #widgetsRoot: string;
  readonly #logger: FastifyBaseLogger;

  constructor(pool: Pool, widgetsRoot: string, logger: FastifyBaseLogger) {
    this.#pool = pool;
    this.#widgetsRoot = path.resolve(widgetsRoot);
    this.#logger = logger;
  }

  async start(): Promise<void> {
    try {
      const result = await this.refresh();
      this.#logger.info({
        scanned: result.scanned,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
      }, "widget catalogue synchronized");
    } catch (error) {
      this.#logger.warn({ err: error }, "initial widget catalogue synchronization failed");
    }
  }

  stop(): void {
    // The catalogue has no long-lived resources.
  }

  async list(): Promise<WidgetCatalogueEntry[]> {
    const result = await this.#pool.query<WidgetRow>(
      `SELECT id, key, version, name, description, metadata, is_active
       FROM widgets
       WHERE is_active = TRUE
       ORDER BY name, key`,
    );
    return result.rows.map(toCatalogueEntry);
  }

  async refresh(actorUserId?: string): Promise<WidgetCatalogueRefreshResult> {
    const scanned = await scanWidgetCatalogue(this.#widgetsRoot);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CATALOGUE_LOCK]);
      const result = await reconcileWidgetCatalogue(client, scanned);
      if (actorUserId !== undefined) {
        await recordActivity(client, {
          actorUserId,
          entityType: "widget-catalogue",
          action: "widgets.refreshed",
          payload: {
            scanned: result.scanned,
            created: result.created,
            updated: result.updated,
            reactivated: result.reactivated,
            deactivated: result.deactivated,
          },
        });
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function scanWidgetCatalogue(widgetsRoot: string): Promise<WidgetMetadata[]> {
  const componentsRoot = path.join(path.resolve(widgetsRoot), "components");
  let directories: string[];
  try {
    directories = (await readdir(componentsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new WidgetCatalogueValidationError([{
      directory: componentsRoot,
      message: error instanceof Error ? error.message : "Widget components directory is unavailable.",
    }]);
  }

  const widgets: WidgetMetadata[] = [];
  const issues: WidgetCatalogueIssue[] = [];
  for (const directoryName of directories) {
    const directory = path.join(componentsRoot, directoryName);
    try {
      if (!WIDGET_KEY_PATTERN.test(directoryName)) {
        throw new Error("Directory name must contain only lowercase letters, numbers, and hyphens.");
      }
      const metadata = WidgetMetadataSchema.parse(
        JSON.parse(await readFile(path.join(directory, "widget.json"), "utf8")),
      );
      if (metadata.id !== directoryName) {
        throw new Error(`Metadata id '${metadata.id}' must match directory '${directoryName}'.`);
      }
      const entry = safeWidgetEntry(metadata.entry);
      const entryPath = path.resolve(directory, entry);
      if (!entryPath.startsWith(`${directory}${path.sep}`)) {
        throw new Error("Widget entry must remain inside its component directory.");
      }
      await access(entryPath);
      if (!(await stat(entryPath)).isFile()) {
        throw new Error(`Widget entry '${entry}' is not a file.`);
      }
      widgets.push(metadata);
    } catch (error) {
      issues.push({
        directory: directoryName,
        message: formatValidationError(error),
      });
    }
  }

  if (issues.length > 0) {
    throw new WidgetCatalogueValidationError(issues);
  }
  return widgets;
}

async function reconcileWidgetCatalogue(
  client: PoolClient,
  widgets: readonly WidgetMetadata[],
): Promise<WidgetCatalogueRefreshResult> {
  const existingResult = await client.query<WidgetRow>(
    `SELECT id, key, version, name, description, metadata, is_active
     FROM widgets
     ORDER BY key, is_active DESC, updated_at DESC
     FOR UPDATE`,
  );
  const rowsByKey = new Map<string, WidgetRow[]>();
  for (const row of existingResult.rows) {
    const rows = rowsByKey.get(row.key) ?? [];
    rows.push(row);
    rowsByKey.set(row.key, rows);
  }

  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let deactivated = 0;
  let unchanged = 0;
  const catalogue: WidgetCatalogueEntry[] = [];

  for (const metadata of widgets) {
    const rows = rowsByKey.get(metadata.id) ?? [];
    const target = rows.find((row) => row.version === metadata.version)
      ?? rows.find((row) => row.is_active)
      ?? rows[0];
    const serializedMetadata = JSON.stringify(metadata);
    let targetId: string;

    if (target === undefined) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO widgets (key, version, name, description, metadata, is_active)
         VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)
         RETURNING id`,
        [metadata.id, metadata.version, metadata.name, metadata.description, serializedMetadata],
      );
      targetId = inserted.rows[0]!.id;
      created += 1;
    } else {
      targetId = target.id;
      const changed = target.version !== metadata.version
        || target.name !== metadata.name
        || target.description !== metadata.description
        || !isDeepStrictEqual(target.metadata, metadata);
      if (changed || !target.is_active) {
        await client.query(
          `UPDATE widgets
           SET version = $2, name = $3, description = $4, metadata = $5::jsonb, is_active = TRUE
           WHERE id = $1`,
          [targetId, metadata.version, metadata.name, metadata.description, serializedMetadata],
        );
      }
      if (changed) updated += 1;
      if (!target.is_active) reactivated += 1;
      if (!changed && target.is_active) unchanged += 1;
    }

    const supersededIds = rows
      .filter((row) => row.id !== targetId)
      .map((row) => row.id);
    if (supersededIds.length > 0) {
      await client.query(
        "UPDATE widget_instances SET widget_id = $1 WHERE widget_id = ANY($2::uuid[])",
        [targetId, supersededIds],
      );
      const retired = await client.query(
        "UPDATE widgets SET is_active = FALSE WHERE id = ANY($1::uuid[]) AND is_active = TRUE",
        [supersededIds],
      );
      deactivated += retired.rowCount ?? 0;
    }
    catalogue.push({ ...metadata, databaseId: targetId });
  }

  const installedKeys = widgets.map((widget) => widget.id);
  const missing = installedKeys.length === 0
    ? await client.query("UPDATE widgets SET is_active = FALSE WHERE is_active = TRUE")
    : await client.query(
        "UPDATE widgets SET is_active = FALSE WHERE is_active = TRUE AND NOT (key = ANY($1::text[]))",
        [installedKeys],
      );
  deactivated += missing.rowCount ?? 0;

  catalogue.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  return {
    scanned: widgets.length,
    created,
    updated,
    reactivated,
    deactivated,
    unchanged,
    refreshedAt: new Date().toISOString(),
    catalogue,
  };
}

function safeWidgetEntry(entry: string): string {
  const normalized = entry.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    normalized.length === 0
    || normalized.includes("\0")
    || path.posix.isAbsolute(normalized)
    || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Widget entry must be a safe relative file path.");
  }
  return normalized;
}

function toCatalogueEntry(row: WidgetRow): WidgetCatalogueEntry {
  const metadata = WidgetMetadataSchema.parse(row.metadata);
  return { ...metadata, databaseId: row.id };
}

function formatValidationError(error: unknown): string {
  if (error instanceof Error && "issues" in error && Array.isArray(error.issues)) {
    return error.issues
      .map((issue) => {
        const candidate = issue as { path?: PropertyKey[]; message?: string };
        const location = candidate.path?.join(".") || "widget.json";
        return `${location}: ${candidate.message ?? "Invalid value"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : "Invalid widget metadata.";
}

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { IoDriverManifestSchema, type IoDriverManifest } from "@scarline/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

import { recordActivity } from "../infrastructure/activity.js";
import { createEnvelope, enqueueMessage } from "../infrastructure/outbox.js";

export interface SensorCatalogueEntry extends IoDriverManifest { readonly databaseKey: string }
export interface SensorCatalogueResult {
  readonly scanned: number; readonly created: number; readonly updated: number;
  readonly deactivated: number; readonly unchanged: number; readonly refreshedAt: string;
  readonly catalogue: readonly SensorCatalogueEntry[];
}

export class SensorCatalogueValidationError extends Error {
  constructor(readonly issues: readonly { file: string; message: string }[]) {
    super(`Sensor refresh rejected ${issues.length} invalid driver manifest${issues.length === 1 ? "" : "s"}.`);
  }
}

export class SensorCatalogueService {
  constructor(readonly pool: Pool, readonly root: string, readonly logger: FastifyBaseLogger) {}
  async start(): Promise<void> {
    try { const result = await this.refresh(); this.logger.info({ scanned: result.scanned }, "sensor catalogue synchronized"); }
    catch (error) { this.logger.warn({ err: error }, "initial sensor catalogue synchronization failed"); }
  }
  stop(): void {}
  async list(): Promise<SensorCatalogueEntry[]> {
    const result = await this.pool.query<{ key: string; manifest: unknown }>("SELECT key,manifest FROM sensor_drivers WHERE is_active=TRUE ORDER BY name,key");
    return result.rows.map(({ key, manifest }) => ({ ...IoDriverManifestSchema.parse(manifest), databaseKey: key }));
  }
  async refresh(actorUserId?: string): Promise<SensorCatalogueResult> {
    const manifests = await scanSensorCatalogue(this.root); const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtext('scarline.sensors.catalogue'))");
      const result = await reconcile(client, manifests);
      if (actorUserId) await recordActivity(client, { actorUserId, entityType: "sensor-catalogue", action: "sensors.refreshed", payload: { ...result } });
      await enqueueMessage(client, createEnvelope({
        routingKey: "commands.io-client.catalogue-refresh",
        payload: { requestedAt: new Date().toISOString() },
      }));
      await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

export async function scanSensorCatalogue(root: string): Promise<IoDriverManifest[]> {
  const issues: { file: string; message: string }[] = []; const manifests: IoDriverManifest[] = [];
  let names: string[];
  try { names = (await readdir(root, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith(".json")).map((item) => item.name).sort(); }
  catch (error) { throw new SensorCatalogueValidationError([{ file: root, message: error instanceof Error ? error.message : "Directory unavailable" }]); }
  for (const name of names) {
    try { const value = IoDriverManifestSchema.parse(JSON.parse(await readFile(path.join(root, name), "utf8"))); if (`${value.key}.json` !== name) throw new Error("Manifest filename must match its key"); manifests.push(value); }
    catch (error) { issues.push({ file: name, message: error instanceof Error ? error.message : "Invalid manifest" }); }
  }
  if (issues.length) throw new SensorCatalogueValidationError(issues);
  return manifests;
}

async function reconcile(client: PoolClient, manifests: readonly IoDriverManifest[]): Promise<SensorCatalogueResult> {
  const existing = await client.query<{ key: string; manifest: unknown; source_hash: string; is_active: boolean }>("SELECT key,manifest,source_hash,is_active FROM sensor_drivers FOR UPDATE");
  const byKey = new Map(existing.rows.map((row) => [row.key, row])); let created=0,updated=0,unchanged=0;
  for (const manifest of manifests) {
    const serialized=JSON.stringify(manifest); const hash=createHash("sha256").update(serialized).digest("hex"); const row=byKey.get(manifest.key);
    if (!row) { await client.query("INSERT INTO sensor_drivers(key,name,version,device_type,manifest,source_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[manifest.key,manifest.name,manifest.version,manifest.deviceType,serialized,hash]); created++; }
    else if (row.source_hash!==hash || !row.is_active || !isDeepStrictEqual(row.manifest,manifest)) { await client.query("UPDATE sensor_drivers SET name=$2,version=$3,device_type=$4,manifest=$5::jsonb,source_hash=$6,is_active=TRUE WHERE key=$1",[manifest.key,manifest.name,manifest.version,manifest.deviceType,serialized,hash]); updated++; } else unchanged++;
    const device = await client.query<{ id: string }>(`INSERT INTO devices(name,type,source_key,status,metadata) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,metadata=EXCLUDED.metadata,status=CASE WHEN devices.status='disabled' THEN devices.status ELSE EXCLUDED.status END,last_seen_at=NOW() RETURNING id`,
      [manifest.name,manifest.deviceType,`driver:${manifest.key}`,manifest.mock?"connected":"disconnected",JSON.stringify({driverKey:manifest.key,version:manifest.version,capabilities:manifest.capabilities,platforms:manifest.platforms,mock:manifest.mock,managedBy:"io-client"})]);
    for (const channel of manifest.channels) await client.query(`INSERT INTO device_sensors(device_id,key,name,modality,unit,metadata,is_active) VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE)
      ON CONFLICT(device_id,key) DO UPDATE SET name=EXCLUDED.name,modality=EXCLUDED.modality,unit=EXCLUDED.unit,metadata=EXCLUDED.metadata,is_active=TRUE`,[device.rows[0]!.id,channel.key,channel.name,channel.modality,channel.unit,JSON.stringify({sampleRate:channel.sampleRate,configurationSchema:channel.configurationSchema})]);
    await client.query("UPDATE device_sensors SET is_active=FALSE WHERE device_id=$1 AND is_active AND NOT(key=ANY($2::text[]))", [device.rows[0]!.id, manifest.channels.map((channel) => channel.key)]);
  }
  const keys=manifests.map((item)=>item.key); const missing=keys.length?await client.query("UPDATE sensor_drivers SET is_active=FALSE WHERE is_active=TRUE AND NOT(key=ANY($1::text[]))",[keys]):await client.query("UPDATE sensor_drivers SET is_active=FALSE WHERE is_active=TRUE");
  if (keys.length) {
    await client.query(`UPDATE device_sensors ds SET is_active=FALSE FROM devices d
      WHERE ds.device_id=d.id AND ds.is_active AND d.metadata->>'managedBy'='io-client' AND NOT(d.metadata->>'driverKey'=ANY($1::text[]))`, [keys]);
    await client.query(`UPDATE devices SET status='disconnected',status_message='Driver manifest is no longer installed'
      WHERE status<>'disabled' AND metadata->>'managedBy'='io-client' AND NOT(metadata->>'driverKey'=ANY($1::text[]))`, [keys]);
  } else {
    await client.query("UPDATE device_sensors ds SET is_active=FALSE FROM devices d WHERE ds.device_id=d.id AND ds.is_active AND d.metadata->>'managedBy'='io-client'");
    await client.query("UPDATE devices SET status='disconnected',status_message='Driver manifest is no longer installed' WHERE status<>'disabled' AND metadata->>'managedBy'='io-client'");
  }
  const catalogue=manifests.map((manifest)=>({...manifest,databaseKey:manifest.key}));
  return {scanned:manifests.length,created,updated,deactivated:missing.rowCount??0,unchanged,refreshedAt:new Date().toISOString(),catalogue};
}

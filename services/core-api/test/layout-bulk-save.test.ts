import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { ParticipantLayoutBulkSaveSchema } from "@scarline/contracts";
import { saveParticipantLayouts } from "../src/layouts/bulk-save.js";

const studyId = randomUUID();
const widgetId = randomUUID();
const conditions = [randomUUID(), randomUUID()].map((id) => ({ id, metadata: {} }));

class LayoutPool {
  layouts: Array<{ id: string; condition_id: string; revision: number }> = [];
  widgets: Array<{ id: string; layout_id: string; widget_id: string; order: number }> = [];
  statements: string[] = [];
  release() {}
  async connect() { return this; }
  async query(sql: string, values: unknown[] = []) {
    this.statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("FROM conditions")) return { rows: conditions };
    if (sql.includes("FROM layouts l JOIN")) return { rows: this.layouts };
    if (sql.includes("SELECT id,key FROM widgets")) return { rows: [{ id: widgetId, key: "time" }] };
    if (sql.includes("INSERT INTO layouts")) {
      const layout = { id: randomUUID(), condition_id: String(values[0]), revision: 1 };
      this.layouts.push(layout);
      return { rows: [layout] };
    }
    if (sql.includes("UPDATE layouts")) {
      const layout = this.layouts.find((entry) => entry.id === values[0])!;
      layout.revision += 1;
      return { rows: [layout] };
    }
    if (sql.includes("FROM widget_instances") && sql.includes("FOR UPDATE")) {
      return { rows: this.widgets.filter((entry) => entry.layout_id === values[0]) };
    }
    if (sql.includes("INSERT INTO widget_instances")) {
      assert.match(sql, /RETURNING id/);
      const widget = { id: randomUUID(), layout_id: String(values[0]), widget_id: String(values[1]), order: Number(values[5]) };
      this.widgets.push(widget);
      return { rows: [widget] };
    }
    if (sql.includes("UPDATE widget_instances")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  }
}

function input(pool: LayoutPool, count: number) {
  return ParticipantLayoutBulkSaveSchema.parse({
    name: "Participant", targetDisplay: "primary", layoutConfig: {},
    expectedRevisions: conditions.map((condition) => {
      const layout = pool.layouts.find((entry) => entry.condition_id === condition.id);
      return { conditionId: condition.id, layoutId: layout?.id ?? null, revision: layout?.revision ?? 0 };
    }),
    widgets: Array.from({ length: count }, (_, order) => ({
      widgetId, order, windowMode: "browser_popup", inputMode: "click_through", targetDisplay: "primary",
      x: order * 180, y: 0, width: 180, height: 180, enabled: true,
      configuration: {}, bindingsConfig: {}, styleOverrides: {},
    })),
  });
}

test("returns committed primary-layout instance IDs for immediate launch, including widgets added later", async () => {
  const pool = new LayoutPool();
  const first = await saveParticipantLayouts(pool as unknown as Pool, studyId, input(pool, 1), null);
  const primary = () => pool.widgets.filter((widget) => widget.layout_id === first.primaryLayoutId)
    .map(({ id, order }) => ({ id, order }));
  assert.deepEqual(first.widgets, primary());
  assert.equal(first.widgets.length, 1);
  assert.equal(pool.statements.at(-1), "COMMIT");

  const added = await saveParticipantLayouts(pool as unknown as Pool, studyId, input(pool, 2), null);
  assert.deepEqual(added.widgets, primary());
  assert.equal(added.widgets[0]!.id, first.widgets[0]!.id);
  assert.notEqual(added.widgets[1]!.id, added.widgets[0]!.id);
  assert.equal(added.layouts.length, 2);
  assert.ok(added.widgets.every((widget) => !pool.widgets.some((other) => other.id === widget.id && other.layout_id !== first.primaryLayoutId)));
});

test("a stale autosave revision fails before changing layouts or publishing instance IDs", async () => {
  const pool = new LayoutPool();
  const stale = input(pool, 1);
  await saveParticipantLayouts(pool as unknown as Pool, studyId, stale, null);
  const before = JSON.stringify(pool.widgets);
  await assert.rejects(() => saveParticipantLayouts(pool as unknown as Pool, studyId, stale, null), /changed elsewhere/);
  assert.equal(JSON.stringify(pool.widgets), before);
  assert.equal(pool.statements.at(-1), "ROLLBACK");
});

import type { Pool, PoolClient } from "pg";
import {
  ParticipantLayoutBulkSaveResultSchema,
  type ParticipantLayoutBulkSaveResult,
  type ParticipantLayoutBulkSave,
} from "@scarline/contracts";

import { ApiProblem } from "../errors.js";

interface ConditionRow {
  id: string;
  metadata: Record<string, unknown>;
}

interface LayoutRow {
  id: string;
  condition_id: string;
  revision: number;
}

interface WidgetRow {
  id: string;
  widget_id: string;
  order: number;
}

export async function saveParticipantLayouts(
  pool: Pool,
  studyId: string,
  input: ParticipantLayoutBulkSave,
  validDisplayIds: Set<string> | null,
): Promise<ParticipantLayoutBulkSaveResult> {
  validateDisplayAssignments(input, validDisplayIds);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const conditions = await client.query<ConditionRow>(
      `SELECT id,metadata FROM conditions
        WHERE study_id=$1 AND archived_at IS NULL
        ORDER BY "order",created_at,id FOR UPDATE`,
      [studyId],
    );
    if (conditions.rows.length === 0) {
      throw new ApiProblem(409, "CONDITION_REQUIRED", "Create a study condition before saving the participant layout.");
    }

    const current = await client.query<LayoutRow>(
      `SELECT l.id,l.condition_id,l.revision
         FROM layouts l JOIN conditions c ON c.id=l.condition_id
        WHERE c.study_id=$1 AND c.archived_at IS NULL AND l.type='participant'
        ORDER BY l.created_at,l.id FOR UPDATE OF l`,
      [studyId],
    );
    const currentByCondition = new Map<string, LayoutRow>();
    for (const layout of current.rows) {
      if (!currentByCondition.has(layout.condition_id)) currentByCondition.set(layout.condition_id, layout);
    }
    assertExpectedRevisions(conditions.rows, currentByCondition, input.expectedRevisions);

    const widgetIds = [...new Set(input.widgets.map((widget) => widget.widgetId))];
    const widgetKeys = widgetIds.length === 0
      ? new Map<string, string>()
      : new Map((await client.query<{ id: string; key: string }>(
          "SELECT id,key FROM widgets WHERE id=ANY($1::uuid[]) AND is_active=TRUE",
          [widgetIds],
        )).rows.map((widget) => [widget.id, widget.key]));
    const missingWidgetIds = widgetIds.filter((id) => !widgetKeys.has(id));
    if (missingWidgetIds.length > 0) {
      throw new ApiProblem(409, "WIDGET_UNAVAILABLE", "One or more participant widgets are no longer available.", { widgetIds: missingWidgetIds });
    }

    const results: ParticipantLayoutBulkSaveResult["layouts"] = [];
    for (const condition of conditions.rows) {
      const previousLayout = currentByCondition.get(condition.id);
      const layout = previousLayout === undefined
        ? (await client.query<LayoutRow>(
            `INSERT INTO layouts(condition_id,name,type,target_display,layout_config,revision)
             VALUES($1,$2,'participant',$3,$4::jsonb,1)
             RETURNING id,condition_id,revision`,
            [condition.id, input.name, input.targetDisplay, JSON.stringify(input.layoutConfig)],
          )).rows[0]!
        : (await client.query<LayoutRow>(
            `UPDATE layouts
                SET name=$3,target_display=$4,layout_config=$5::jsonb,revision=revision+1
              WHERE id=$1 AND condition_id=$2
              RETURNING id,condition_id,revision`,
            [previousLayout.id, condition.id, input.name, input.targetDisplay, JSON.stringify(input.layoutConfig)],
          )).rows[0]!;
      await replaceLayoutWidgets(client, layout.id, condition.metadata, input, widgetKeys);
      results.push({ conditionId: condition.id, layoutId: layout.id, revision: layout.revision });
    }

    await client.query("COMMIT");
    return ParticipantLayoutBulkSaveResultSchema.parse({
      primaryLayoutId: results[0]!.layoutId,
      layouts: results,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertExpectedRevisions(
  conditions: ConditionRow[],
  currentByCondition: Map<string, LayoutRow>,
  expected: ParticipantLayoutBulkSave["expectedRevisions"],
): void {
  const expectedByCondition = new Map(expected.map((entry) => [entry.conditionId, entry]));
  const conflict = conditions.some((condition) => {
    const wanted = expectedByCondition.get(condition.id);
    const current = currentByCondition.get(condition.id);
    if (wanted === undefined) return true;
    return current === undefined
      ? wanted.layoutId !== null || wanted.revision !== 0
      : wanted.layoutId !== current.id || wanted.revision !== current.revision;
  }) || expectedByCondition.size !== conditions.length;
  if (!conflict) return;
  throw new ApiProblem(
    409,
    "LAYOUT_VERSION_CONFLICT",
    "The participant layout changed elsewhere. Reload Participant View before saving again.",
    {
      currentRevisions: conditions.map((condition) => {
        const current = currentByCondition.get(condition.id);
        return { conditionId: condition.id, layoutId: current?.id ?? null, revision: current?.revision ?? 0 };
      }),
    },
  );
}

async function replaceLayoutWidgets(
  client: PoolClient,
  layoutId: string,
  conditionMetadata: Record<string, unknown>,
  input: ParticipantLayoutBulkSave,
  widgetKeys: Map<string, string>,
): Promise<void> {
  const previous = (await client.query<WidgetRow>(
    `SELECT id,widget_id,"order" AS "order" FROM widget_instances
      WHERE layout_id=$1 ORDER BY "order",id FOR UPDATE`,
    [layoutId],
  )).rows;
  const hidden = readHiddenWidgets(conditionMetadata);
  const used = new Set<string>();
  for (const widget of [...input.widgets].sort((left, right) => left.order - right.order)) {
    const match = previous.find((entry) =>
      !used.has(entry.id) && entry.widget_id === widget.widgetId && entry.order === widget.order
    ) ?? previous.find((entry) => !used.has(entry.id) && entry.widget_id === widget.widgetId);
    if (match !== undefined) used.add(match.id);
    const aliases = [widget.widgetId, widgetKeys.get(widget.widgetId) ?? "", match?.id ?? ""];
    const enabled = widget.enabled && !aliases.some((alias) => alias !== "" && hidden.has(alias));
    const values = [
      layoutId, widget.widgetId, widget.windowMode, widget.inputMode, widget.targetDisplay,
      widget.order, widget.x, widget.y, widget.width, widget.height, enabled,
      JSON.stringify(widget.configuration), JSON.stringify(widget.bindingsConfig), JSON.stringify(widget.styleOverrides),
    ];
    if (match === undefined) {
      await client.query(
        `INSERT INTO widget_instances(
           layout_id,widget_id,window_mode,input_mode,target_display,"order",x,y,width,height,
           enabled,configuration,bindings_config,style_overrides
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)`,
        values,
      );
    } else {
      await client.query(
        `UPDATE widget_instances SET
           widget_id=$2,window_mode=$3,input_mode=$4,target_display=$5,"order"=$6,x=$7,y=$8,
           width=$9,height=$10,enabled=$11,configuration=$12::jsonb,bindings_config=$13::jsonb,style_overrides=$14::jsonb
         WHERE id=$15 AND layout_id=$1`,
        [...values, match.id],
      );
    }
  }
  const removed = previous.filter((entry) => !used.has(entry.id)).map((entry) => entry.id);
  if (removed.length > 0) {
    await client.query("DELETE FROM widget_instances WHERE layout_id=$1 AND id=ANY($2::uuid[])", [layoutId, removed]);
  }
}

function readHiddenWidgets(metadata: Record<string, unknown>): Set<string> {
  const overrides = readRecord(metadata.widgetOverrides);
  return new Set(Array.isArray(overrides.hidden_widgets)
    ? overrides.hidden_widgets.map(String).filter(Boolean)
    : []);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validateDisplayAssignments(input: ParticipantLayoutBulkSave, validDisplayIds: Set<string> | null): void {
  if (validDisplayIds === null) return;
  const valid = new Set(["primary", ...validDisplayIds]);
  const affectedWidgets = input.widgets
    .filter((widget) => !valid.has(widget.targetDisplay))
    .map((widget) => ({ order: widget.order, widgetId: widget.widgetId, targetDisplay: widget.targetDisplay }));
  if (affectedWidgets.length === 0 && (input.targetDisplay === null || valid.has(input.targetDisplay))) return;
  throw new ApiProblem(
    409,
    "LAYOUT_DISPLAY_UNAVAILABLE",
    "Reassign widgets whose saved display is unavailable before saving the participant layout.",
    { affectedWidgets, targetDisplay: input.targetDisplay },
  );
}

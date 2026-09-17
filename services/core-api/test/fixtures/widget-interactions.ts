import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import type { OverlayRuntimeScope } from "@scarline/contracts";

export const ids = {
  study: "550e8400-e29b-41d4-a716-446655440001", session: "550e8400-e29b-41d4-a716-446655440002",
  condition: "550e8400-e29b-41d4-a716-446655440003", layout: "550e8400-e29b-41d4-a716-446655440004",
  call: "550e8400-e29b-41d4-a716-446655440005", music: "550e8400-e29b-41d4-a716-446655440006",
  sessionCondition: "550e8400-e29b-41d4-a716-446655440007", preview: "550e8400-e29b-41d4-a716-446655440008",
};
export const scope: OverlayRuntimeScope = { rendererMode: "browser", studyId: ids.study,
  sessionId: ids.session, conditionId: ids.condition, layoutId: ids.layout, instanceId: null };

export class InteractionDatabase {
  runtime: Record<string, unknown> = {};
  conditionMetadata: Record<string, unknown> = {};
  sessionStatus = "running";
  activeCondition = ids.condition;
  hidden = false;
  failOutbox = false;
  events: Record<string, unknown>[] = [];
  private tail: Promise<void> = Promise.resolve();
  widgets = ["activecall", "music"].map((key, order) => ({
    instance_id: order === 0 ? ids.call : ids.music,
    widget_id: order === 0 ? ids.call : ids.music, widget_key: key,
    window_mode: "browser_popup", target_display: "primary", order,
    x: 0, y: 0, width: 640, height: 500, enabled: true,
    configuration: {}, bindings_config: {}, style_overrides: {},
    metadata: JSON.parse(readFileSync(new URL(`../../../../widgets/components/${key}/widget.json`, import.meta.url), "utf8")),
  }));

  readonly pool = {
    query: (text: string, values?: unknown[]) => this.query(text, values),
    connect: async () => {
      let unlock: () => void = () => {};
      let before: Record<string, unknown> = {};
      let eventCount = 0;
      return {
        query: async (text: string, values?: unknown[]) => {
          if (text === "BEGIN") {
            const previous = this.tail;
            this.tail = new Promise<void>((resolve) => { unlock = resolve; });
            await previous;
            before = structuredClone(this.runtime);
            eventCount = this.events.length;
          }
          if (text === "ROLLBACK") { this.runtime = before; this.events.length = eventCount; }
          if (text === "COMMIT" || text === "ROLLBACK") unlock();
          return this.query(text, values);
        }, release: () => undefined,
      };
    },
  } as unknown as Pool;

  async query(text: string, values: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const rows = (rows: any[]) => ({ rows, rowCount: rows.length });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return rows([]);
    if (text.includes("FROM layouts l JOIN conditions")) return rows([{
      id: ids.layout, condition_id: ids.condition, study_id: ids.study,
      name: "Participant", type: "participant", target_display: "primary", condition_metadata: this.conditionMetadata,
    }]);
    if (text.includes("FROM widget_instances wi JOIN widgets")) return rows(this.widgets.filter((widget) =>
      widget.enabled && (values[1] === undefined || widget.instance_id === values[1])));
    if (text.includes("FROM sessions WHERE id=$1 FOR UPDATE")) return rows([{ study_id: ids.study, status: this.sessionStatus }]);
    if (text.includes("FROM session_conditions")) return rows([{
      id: ids.sessionCondition, condition_id: this.activeCondition, runtime_metadata: this.runtime,
    }]);
    if (text.includes("WHERE wi.id=$1")) {
      const widget = this.widgets.find((entry) => entry.instance_id === values[0]);
      return rows(widget ? [{ ...widget, layout_type: "participant", layout_name: "Participant", study_id: ids.study }] : []);
    }
    if (text.includes("WHERE l.condition_id=$1")) {
      const widget = this.widgets.find((entry) => entry.widget_key === values[3] && entry.enabled);
      return rows(widget ? [{ ...widget, layout_type: "participant", layout_name: "Participant", condition_metadata: this.conditionMetadata }] : []);
    }
    if (text.startsWith("UPDATE session_conditions SET runtime_metadata")) {
      this.runtime = JSON.parse(String(values[1]));
      return rows([]);
    }
    if (text.includes("INSERT INTO event_outbox")) {
      if (this.failOutbox) throw new Error("Outbox unavailable");
      this.events.push(JSON.parse(String(values[3])));
      return rows([]);
    }
    throw new Error(`Unexpected fixture query: ${text}`);
  }
}

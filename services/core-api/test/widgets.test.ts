import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  scanWidgetCatalogue,
  WidgetCatalogueValidationError,
} from "../src/widgets/catalogue.js";

function metadata(id: string, entry = "index.html") {
  return {
    id,
    name: `Widget ${id}`,
    description: "Test widget",
    version: "1.0.0",
    category: "general",
    entry,
    bindings: [],
    triggers: [],
    ui: {
      minWidth: 100,
      minHeight: 80,
      preferredWidth: 200,
      preferredHeight: 160,
    },
  };
}

async function createWidget(root: string, directory: string, widget: object, createEntry = true) {
  const component = path.join(root, "components", directory);
  await mkdir(component, { recursive: true });
  await writeFile(path.join(component, "widget.json"), JSON.stringify(widget), "utf8");
  if (createEntry) await writeFile(path.join(component, "index.html"), "<!doctype html>", "utf8");
}

test("discovers and normalizes a valid widget catalogue", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "scarline-widgets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await createWidget(root, "status-card", metadata("status-card"));

  const catalogue = await scanWidgetCatalogue(root);

  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0]?.id, "status-card");
  assert.deepEqual(catalogue[0]?.ui, {
    minWidth: 100,
    minHeight: 80,
    preferredWidth: 200,
    preferredHeight: 160,
  });
});

test("rejects the whole refresh when widget identities or entries are invalid", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "scarline-widgets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await createWidget(root, "mismatched", metadata("another-widget"));
  await createWidget(root, "missing-entry", metadata("missing-entry"), false);

  await assert.rejects(
    () => scanWidgetCatalogue(root),
    (error: unknown) => {
      assert.ok(error instanceof WidgetCatalogueValidationError);
      assert.equal(error.issues.length, 2);
      assert.deepEqual(error.issues.map((issue) => issue.directory), ["mismatched", "missing-entry"]);
      return true;
    },
  );
});

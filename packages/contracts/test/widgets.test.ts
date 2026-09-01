import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WidgetMetadataSchema } from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const widgetsRoot = path.join(repositoryRoot, "widgets");
const componentsRoot = path.join(widgetsRoot, "components");

function attributeValues(html: string, attribute: string): string[] {
  return [...html.matchAll(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "gu"))]
    .map((match) => match[1]!);
}

test("validates every installed widget and its shared runtime boundary", () => {
  const directories = readdirSync(componentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(directories.length, 24);
  for (const directoryName of directories) {
    const directory = path.join(componentsRoot, directoryName);
    const metadataInput = JSON.parse(readFileSync(path.join(directory, "widget.json"), "utf8"));
    const metadata = WidgetMetadataSchema.parse(metadataInput);
    const entry = path.join(directory, metadata.entry);
    const html = readFileSync(entry, "utf8");

    assert.equal(metadata.id, directoryName);
    assert.match(html, /\.\.\/\.\.\/dist\.css/u);
    assert.match(html, /\.\.\/\.\.\/widget-runtime\.js/u);
    assert.match(html, /data-scarline-widget-root/u);
    assert.doesNotMatch(
      html,
      /fetch\s*\(|new\s+WebSocket|XMLHttpRequest|EventSource|document\.cookie|localStorage|sessionStorage/u,
    );

    const bindingKeys = new Set(metadata.bindings.map((binding) => binding.key));
    const actionKeys = new Set(metadata.triggers.map((trigger) => trigger.action));
    assert.deepEqual(
      [...new Set(attributeValues(html, "data-bind"))].filter((key) => !bindingKeys.has(key)),
      [],
      `${directoryName} uses undeclared bindings`,
    );
    assert.deepEqual(
      [...new Set(attributeValues(html, "data-action"))].filter((key) => !actionKeys.has(key)),
      [],
      `${directoryName} uses undeclared actions`,
    );
    assert.deepEqual(
      [...actionKeys].filter((key) => !attributeValues(html, "data-action").includes(key)),
      [],
      `${directoryName} declares unused actions`,
    );

    for (const reference of attributeValues(html, "(?:src|href)")) {
      if (/^(?:https?:|data:|#|\/)/u.test(reference)) continue;
      assert.equal(
        existsSync(path.resolve(directory, reference.split(/[?#]/u, 1)[0]!)),
        true,
        `${directoryName} references missing asset ${reference}`,
      );
    }
  }
});

test("rejects widget binding defaults with the wrong type", () => {
  const speedometer = JSON.parse(
    readFileSync(path.join(componentsRoot, "speedometer", "widget.json"), "utf8"),
  );
  speedometer.bindings["vehicle.speed"].default = "fast";
  assert.equal(WidgetMetadataSchema.safeParse(speedometer).success, false);
});

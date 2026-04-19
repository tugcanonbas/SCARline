import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const electronBin = path.join(
  root,
  "apps/desktop-overlay/node_modules/.bin/electron",
);
const harness = path.join(root, "tests/widgets/widget-runtime.browser-harness.mjs");

function runHarness() {
  return new Promise((resolve) => {
    const child = spawn(electronBin, [harness], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("renderer-backed widget runtime scenarios pass in Chromium", { timeout: 60_000 }, async (t) => {
  try {
    await access(electronBin, fsConstants.X_OK);
  } catch {
    t.skip("Electron binary is not available for widget browser tests");
    return;
  }

  const result = await runHarness();
  if (
    result.signal === "SIGABRT"
    || /Electron exited with signal SIGABRT/i.test(result.stderr)
    || /Unable to launch/i.test(result.stderr)
  ) {
    t.skip("Electron could not launch in the current environment");
    return;
  }

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true/);
});

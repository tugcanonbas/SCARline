import assert from "node:assert/strict";
import test from "node:test";

import { absoluteBounds, orderedDisplays } from "../src/geometry.js";

const displays = [
  { id: 20, label: "Right", scaleFactor: 1, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  { id: 10, label: "Primary", scaleFactor: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
];

test("reports stable display ids while keeping primary first", () => {
  const result = orderedDisplays(displays, 10);
  assert.deepEqual(result.map(({ id, index, primary }) => ({ id, index, primary })), [
    { id: "10", index: 0, primary: true },
    { id: "20", index: 1, primary: false },
  ]);
});

test("converts display-relative geometry only inside the desktop host", () => {
  assert.deepEqual(absoluteBounds(displays[0]!, {
    instanceId: "00000000-0000-4000-8000-000000000000",
    targetDisplay: "20",
    windowMode: "transparent_electron",
    inputMode: "click_through",
    coordinateSpace: "display-relative",
    x: 12,
    y: 34,
    width: 300,
    height: 200,
  }), { x: 1932, y: 34, width: 300, height: 200 });
});

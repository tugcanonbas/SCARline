import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';

test('shared rabbitmq contract keeps dual exchanges and simulator apply-control', async () => {
  const source = await readFile(path.join(root, 'packages/contracts/src/rabbitmq.ts'), 'utf8');
  assert.match(source, /scarline\.events/);
  assert.match(source, /scarline\.commands/);
  assert.match(source, /bind-session/);
  assert.match(source, /pause-session/);
  assert.match(source, /resume-session/);
  assert.match(source, /unbind-session/);
  assert.match(source, /apply-control/);
  assert.match(source, /start-session/);
  assert.match(source, /stop-session/);
});

test('shared API contract exports full PRD DTO schemas', async () => {
  const source = await readFile(path.join(root, 'packages/contracts/src/api.ts'), 'utf8');
  for (const schema of [
    'researcherSchema',
    'userAdminSchema',
    'deviceSchema',
    'triggerRuleSchema',
    'exportJobSchema',
    'sessionLogEntrySchema',
    'sessionSummarySchema'
  ]) {
    assert.match(source, new RegExp(`export const ${schema}`));
  }
});

test('widget catalogue directories contain widget.json and index.html', async () => {
  const widgetsDir = path.join(root, 'widgets');
  const entries = await readdir(widgetsDir, { withFileTypes: true });
  const widgetDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  assert.deepEqual(widgetDirs.sort(), ['navigation-prompt', 'speedometer', 'time']);

  for (const widget of widgetDirs) {
    const metadata = JSON.parse(await readFile(path.join(widgetsDir, widget, 'widget.json'), 'utf8'));
    const html = await readFile(path.join(widgetsDir, widget, 'index.html'), 'utf8');
    assert.equal(metadata.id, widget);
    assert.ok(Array.isArray(metadata.bindings));
    assert.match(html, /SCARline/);
  }
});

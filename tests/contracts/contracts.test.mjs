import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  assert.match(source, /vehicle\.lane_invasion/);
  assert.match(source, /world\.snapshot/);
  assert.match(source, /sensor\.camera/);
  assert.match(source, /sensor\.gnss/);
  assert.match(source, /sensor\.imu/);
  assert.match(source, /exportProgressPayloadSchema/);
  assert.match(source, /io\.driver_status/);
});

test('shared websocket contract preserves sim-bridge bridge compatibility and export progress', async () => {
  const source = await readFile(path.join(root, 'packages/contracts/src/websocket.ts'), 'utf8');
  assert.match(source, /SIM_BRIDGE_WEBSOCKET_PATHS/);
  assert.match(source, /bridgeCompatibility: '\/bridge'/);
  assert.match(source, /export\.progress/);
  assert.match(source, /exportProgressWebSocketPayloadSchema/);
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
  const widgetsRoot = path.join(root, 'widgets');
  const componentsDir = path.join(widgetsRoot, 'components');
  const widgetsDir = await readdir(componentsDir).then(() => componentsDir).catch(() => widgetsRoot);
  const entries = await readdir(widgetsDir, { withFileTypes: true });
  const widgetDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  assert.deepEqual(widgetDirs.sort(), [
    'activecall',
    'appointments',
    'avatar',
    'bp',
    'calendar',
    'calldeclined',
    'callended',
    'contact',
    'contactlist',
    'ecg',
    'hr',
    'incomingcall',
    'music',
    'navigation-prompt',
    'operator-controls',
    'operator-notes',
    'outgoingcall',
    'resp',
    'sensor-health',
    'session-timeline',
    'speedometer',
    'spo2',
    'study-instruction',
    'time'
  ]);

  for (const widget of widgetDirs) {
    const metadata = JSON.parse(await readFile(path.join(widgetsDir, widget, 'widget.json'), 'utf8'));
    const html = await readFile(path.join(widgetsDir, widget, 'index.html'), 'utf8');
    assert.equal(metadata.id, widget);
    assert.equal(metadata.entry, 'index.html');
    assert.ok(['driving', 'communication', 'health', 'study', 'general'].includes(metadata.category));
    assert.ok(Array.isArray(metadata.bindings) || (metadata.bindings && typeof metadata.bindings === 'object'));
    const minWidth = metadata.ui?.minWidth ?? metadata.ui?.minSize?.w;
    const preferredWidth = metadata.ui?.preferredWidth ?? metadata.ui?.preferredSize?.w;
    assert.ok(Number(minWidth) > 0);
    assert.ok(Number(preferredWidth) >= Number(minWidth));
    assert.match(html, /<body/i);
    assert.doesNotMatch(html, /bg-gray-200/);
    assert.doesNotMatch(html, /\bfetch\s*\(/);
    assert.doesNotMatch(html, /new\s+WebSocket/);
  }
});

test('widget binding metadata stays aligned with index.html data-bind usage', async () => {
  const componentsDir = path.join(root, 'widgets/components');
  const entries = await readdir(componentsDir, { withFileTypes: true });
  const widgetDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  for (const widget of widgetDirs) {
    const metadata = JSON.parse(await readFile(path.join(componentsDir, widget, 'widget.json'), 'utf8'));
    const html = await readFile(path.join(componentsDir, widget, 'index.html'), 'utf8');
    const declaredBindings = new Set(
      Array.isArray(metadata.bindings)
        ? metadata.bindings.map((binding) => binding.key)
        : Object.keys(metadata.bindings ?? {})
    );
    const htmlBindings = new Set(
      [...html.matchAll(/data-bind="([^"]+)"/g)]
        .map((match) => match[1])
        .filter(Boolean)
    );

    assert.deepEqual(
      [...htmlBindings].sort(),
      [...declaredBindings].sort(),
      `${widget} bindings must match between widget.json and index.html`
    );
  }
});

test('overlay runtime implements PRD widget lifecycle controls', async () => {
  const source = await readFile(path.join(root, 'apps/overlay-web/public/app.js'), 'utf8');
  assert.match(source, /requestFullscreen/);
  assert.match(source, /reconnectAttempt/);
  assert.match(source, /widgetOverrides/);
  assert.match(source, /hidden_widgets/);
  assert.match(source, /highlighted_widgets/);
  assert.match(source, /export\.progress/);
  assert.match(source, /applyExportProgress/);
  assert.match(source, /setExportIndicator/);
  assert.match(source, /blockNetwork/);
  assert.match(source, /allowedBindings/);
  assert.match(source, /applyDomBinding/);
  assert.match(source, /body > \*:first-child/);
  assert.match(source, /localDateBindings/);
  assert.match(source, /sensorSnapshots/);
  assert.match(source, /speed_arc_offset/);
  assert.match(source, /normalizeWebSocketUrl/);
  assert.match(source, /searchParams\.set\('token'/);
  assert.match(source, /toggleClassTokens/);
  assert.match(source, /installDesktopWindowChrome/);
  assert.match(source, /overlayControlOrigin/);
  assert.match(source, /pushDesktopWindowBounds/);
  assert.match(source, /\/windows\/update/);
  assert.match(source, /persistCurrentWindowBounds/);
  assert.match(source, /\/api\/system\/overlay\/windows\/update/);
  assert.match(source, /data-scarline-runtime/);
  assert.match(source, /root\.style\.background = 'transparent'/);
  assert.match(source, /root\.style\.boxShadow = 'none'/);
  assert.match(source, /frame\.setAttribute\('allowtransparency', 'true'\)/);
  assert.doesNotMatch(source, /dragHandle\.textContent = 'Move'/);
  assert.doesNotMatch(source, /resizeHandle\.textContent = '◢'/);
  assert.match(source, /dataset\.bindStyle/);
  assert.match(source, /setWidgetState/);
  assert.match(source, /sandbox', 'allow-scripts/);
  assert.match(source, /widget-send/);
  assert.match(source, /instanceId/);
  assert.match(source, /postJson/);
  assert.match(source, /loadWidgetAssets/);
  assert.match(source, /assetPrefix/);
  assert.match(source, /widget\.json/);
  assert.match(source, /index\.html/);
});

test('every widget implements the SCARline binding lifecycle locally', async () => {
  const componentsDir = path.join(root, 'widgets/components');
  const entries = await readdir(componentsDir, { withFileTypes: true });
  const widgetDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  for (const widget of widgetDirs) {
    const html = await readFile(path.join(componentsDir, widget, 'index.html'), 'utf8');
    assert.match(html, /window\.SCARline\.onBinding\(/, `${widget} must subscribe to bindings`);
    assert.match(html, /window\.SCARline\.onTrigger\(/, `${widget} must subscribe to trigger events`);
    assert.match(html, /window\.SCARline\.onStateChange\(/, `${widget} must subscribe to state changes`);
    assert.match(html, /window\.SCARline\.ready\(\)/, `${widget} must signal readiness`);
    assert.match(html, /window\.SCARline\.getBinding\(/, `${widget} must hydrate initial binding values`);
    assert.match(html, /toggleClassTokens/, `${widget} must normalize class token bindings safely`);

    if (/data-action=/.test(html)) {
      assert.match(html, /window\.SCARline\.send\(/, `${widget} actions must bridge through SCARline.send`);
    }
  }
});

test('operator controls widget exposes runtime action bindings in markup and metadata', async () => {
  const html = await readFile(path.join(root, 'widgets/components/operator-controls/index.html'), 'utf8');
  const metadata = await readFile(path.join(root, 'widgets/components/operator-controls/widget.json'), 'utf8');
  assert.match(html, /data-action="controls\.primary"/);
  assert.match(html, /data-action="controls\.secondary"/);
  assert.match(html, /data-action="controls\.tertiary"/);
  assert.match(metadata, /"controls\.primary"/);
  assert.match(metadata, /"controls\.secondary"/);
  assert.match(metadata, /"controls\.tertiary"/);
});

test('overlay services expose widget validation and desktop recovery controls', async () => {
  const webServer = await readFile(path.join(root, 'apps/overlay-web/src/server.ts'), 'utf8');
  assert.match(webServer, /validateWidgetMetadata/);
  assert.match(webServer, /validWidgetCategories/);
  assert.match(webServer, /validBindingTypes/);
  assert.match(webServer, /entry must be index\.html/);

  const desktopOverlay = await readFile(path.join(root, 'apps/desktop-overlay/src/main.mjs'), 'utf8');
  assert.match(desktopOverlay, /render-process-gone/);
  assert.match(desktopOverlay, /did-fail-load/);
  assert.match(desktopOverlay, /\/windows\/open/);
  assert.match(desktopOverlay, /\/windows\/update/);
  assert.match(desktopOverlay, /overlayStatus/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routesRoot = path.join(root, 'apps/admin-panel/src/routes');

async function readRoute(routePath) {
  return readFile(path.join(routesRoot, routePath), 'utf8');
}

test('admin panel exposes PRD route coverage files', async () => {
  for (const routeFile of [
    'dashboard/+page.server.ts',
    'user-studies/+page.server.ts',
    'user-studies/new/+page.server.ts',
    'user-studies/[id]/+page.server.ts',
    'user-studies/[id]/overview/+page.server.ts',
    'user-studies/[id]/participants/+page.server.ts',
    'user-studies/[id]/conditions/+page.server.ts',
    'user-studies/[id]/sessions/+page.server.ts',
    'user-studies/[id]/carla-config/+page.server.ts',
    'user-studies/[id]/sensors/+page.server.ts',
    'user-studies/[id]/participant-view/+page.server.ts',
    'user-studies/[id]/active-study/+page.server.ts',
    'session-logs/+page.server.ts',
    'session-logs/[id]/+page.server.ts',
    'researchers/+page.server.ts',
    'researchers/new/+page.server.ts',
    'researchers/[id]/+page.server.ts',
    'settings/system/+page.server.ts',
    'settings/+page.server.ts',
    'settings/devices/+page.server.ts',
    'settings/users/+page.server.ts',
    'settings/components/+page.server.ts',
    'documentation/+page.server.ts',
    'exports/+page.server.ts',
    'exports/[id]/download/+server.ts'
  ]) {
    await access(path.join(routesRoot, routeFile));
  }
});

test('authenticated admin routes enforce route-level RBAC before rendering or mutating', async () => {
  for (const routeFile of [
    'dashboard/+page.server.ts',
    'user-studies/+page.server.ts',
    'user-studies/new/+page.server.ts',
    'user-studies/[id]/+page.server.ts',
    'user-studies/[id]/overview/+page.server.ts',
    'user-studies/[id]/participants/+page.server.ts',
    'user-studies/[id]/conditions/+page.server.ts',
    'user-studies/[id]/sessions/+page.server.ts',
    'user-studies/[id]/carla-config/+page.server.ts',
    'user-studies/[id]/sensors/+page.server.ts',
    'user-studies/[id]/participant-view/+page.server.ts',
    'user-studies/[id]/active-study/+page.server.ts',
    'researchers/+page.server.ts',
    'researchers/new/+page.server.ts',
    'researchers/[id]/+page.server.ts',
    'settings/system/+page.server.ts',
    'settings/+page.server.ts',
    'settings/devices/+page.server.ts',
    'settings/users/+page.server.ts',
    'settings/components/+page.server.ts',
    'session-logs/+page.server.ts',
    'session-logs/[id]/+page.server.ts',
    'documentation/+page.server.ts',
    'exports/+page.server.ts'
  ]) {
    const source = await readRoute(routeFile);
    assert.match(source, /requireRole/);
  }
});

test('active study server route wires lifecycle and trigger actions', async () => {
  const source = await readRoute('user-studies/[id]/active-study/+page.server.ts');
  for (const action of ['start', 'pause', 'resume', 'complete', 'cancel', 'note', 'trigger']) {
    assert.match(source, new RegExp(`${action}:\\s*async`));
  }
  assert.match(source, /sessions\/\$\{sessionId\}\/triggers/);
  assert.match(source, /sessions\/\$\{sessionId\}\/notes/);
});

test('active study browser launch uses direct overlay window opens', async () => {
  const source = await readRoute('user-studies/[id]/active-study/+page.svelte');
  assert.match(source, /Launch Browser Popup Widgets/);
  assert.match(source, /launchBrowserWidgetWindows/);
  assert.match(source, /\/api\/system\/overlay\/windows\/open/);
  assert.doesNotMatch(source, /overlay\/launcher/);
});

test('sensor configuration route supports explicit driver saves and defaults', async () => {
  const source = await readRoute('user-studies/[id]/sensors/+page.server.ts');
  assert.match(source, /preset:\s*async/);
  assert.match(source, /save:\s*async/);
  assert.match(source, /driverId/);
  assert.match(source, /sample_rate/);
  assert.match(source, /parseJsonObject/);
});

test('admin routes do not mix default and named page actions', async () => {
  for (const routeFile of [
    'user-studies/[id]/conditions/+page.server.ts',
    'user-studies/[id]/sensors/+page.server.ts',
    'settings/system/+page.server.ts',
    'settings/users/+page.server.ts',
    'settings/devices/+page.server.ts',
    'exports/+page.server.ts',
    'researchers/[id]/+page.server.ts',
    'user-studies/[id]/sessions/+page.server.ts',
    'user-studies/[id]/active-study/+page.server.ts'
  ]) {
    const source = await readRoute(routeFile);
    const hasDefaultAction = /default:\s*async/.test(source);
    const namedActions = Array.from(source.matchAll(/^\s*([a-zA-Z][\w]*):\s*async/gm))
      .map(([, actionName]) => actionName)
      .filter((actionName) => actionName !== 'default');

    assert.equal(
      hasDefaultAction && namedActions.length > 0,
      false,
      `${routeFile} mixes default and named actions`
    );
  }
});

test('participant view editor exposes widget bindings, triggers, and style overrides', async () => {
  const source = await readRoute('user-studies/[id]/participant-view/+page.svelte');
  assert.match(source, /Bindings Config/);
  assert.match(source, /Trigger Rules/);
  assert.match(source, /Style Overrides/);
  assert.match(source, /targetDisplay/);
  assert.match(source, /launchMode/);
  assert.match(source, /Launch Selected Mode/);
  assert.match(source, /Close All Widgets/);
  assert.match(source, /Target display/);
  assert.match(source, /overlayDisplays/);
  assert.match(source, /selectedDisplay\.bounds/);
  assert.match(source, /preferredWidth/);
  assert.match(source, /preferredHeight/);
  assert.match(source, /windows\/close/);
  assert.match(source, /Must be a JSON object/);
  assert.match(source, /Must be a JSON array/);
  assert.match(source, /getWidgetPreviewUrl/);
  assert.match(source, /preview=admin/);
  assert.match(source, /layout-widget-preview__frame/);
  assert.match(source, /sandbox="allow-scripts"/);
});

test('exports mutations stay restricted to admin and researcher roles', async () => {
  const source = await readRoute('exports/+page.server.ts');
  assert.match(source, /requireRole\([^)]*\['admin', 'researcher'\]\)/);
  assert.doesNotMatch(source, /\['admin', 'researcher', 'operator'\]/);
});

test('admin panel route RBAC matches documented role matrix', async () => {
  for (const routeFile of [
    'researchers/+page.server.ts',
    'researchers/[id]/+page.server.ts',
    'settings/devices/+page.server.ts',
    'settings/components/+page.server.ts',
    'user-studies/[id]/conditions/+page.server.ts',
    'user-studies/[id]/carla-config/+page.server.ts',
    'user-studies/[id]/sensors/+page.server.ts',
    'user-studies/[id]/participant-view/+page.server.ts'
  ]) {
    const source = await readRoute(routeFile);
    assert.match(source, /requireRole\([^)]*\['admin', 'researcher'\]\)/, routeFile);
    assert.doesNotMatch(source, /\['admin', 'researcher', 'operator', 'viewer'\]/, routeFile);
  }

  const activeStudy = await readRoute('user-studies/[id]/active-study/+page.server.ts');
  assert.match(activeStudy, /requireRole\([^)]*\['admin', 'researcher', 'operator'\]\)/);
  assert.doesNotMatch(activeStudy, /\['admin', 'researcher', 'operator', 'viewer'\]/);
});

test('production admin pages do not render placeholder preformatted JSON views', async () => {
  for (const routeFile of [
    'dashboard/+page.svelte',
    'startup/+page.svelte',
    'user-studies/[id]/overview/+page.svelte',
    'user-studies/[id]/participants/+page.svelte',
    'user-studies/[id]/conditions/+page.svelte',
    'user-studies/[id]/sessions/+page.svelte',
    'user-studies/[id]/carla-config/+page.svelte',
    'user-studies/[id]/sensors/+page.svelte',
    'user-studies/[id]/participant-view/+page.svelte',
    'user-studies/[id]/active-study/+page.svelte',
    'settings/system/+page.svelte',
    'settings/components/+page.svelte',
    'session-logs/[id]/+page.svelte'
  ]) {
    const source = await readRoute(routeFile);
    assert.doesNotMatch(source, /<pre/);
  }
});

test('admin navigation and nginx route PRD admin paths through the Svelte shell', async () => {
  const layout = await readRoute('+layout.svelte');
  const nginx = await readFile(path.join(root, 'infra/nginx/default.conf'), 'utf8');

  for (const route of [
    '/dashboard',
    '/user-studies',
    '/session-logs',
    '/exports',
    '/researchers',
    '/settings/system',
    '/settings/users',
    '/settings/devices',
    '/settings/components',
    '/documentation'
  ]) {
    assert.match(layout, new RegExp(route.replaceAll('/', '\\/')));
  }

  assert.doesNotMatch(nginx, /location = \/documentation\s*\{\s*return 308 \/docs\//);
  assert.match(nginx, /session-logs\|exports/);
  assert.match(nginx, /location \/docs\//);
});

test('admin auth handles real logout and bootstrap outages explicitly', async () => {
  const login = await readRoute('login/+page.server.ts');
  const hooks = await readFile(path.join(root, 'apps/admin-panel/src/hooks.server.ts'), 'utf8');
  const auth = await readFile(path.join(root, 'apps/admin-panel/src/lib/server/auth.ts'), 'utf8');
  const bootstrap = await readFile(path.join(root, 'apps/admin-panel/src/lib/server/bootstrap.ts'), 'utf8');
  const layout = await readRoute('+layout.server.ts');

  assert.match(login, /\/auth\/logout/);
  assert.match(login, /redirectTo/);
  assert.match(login, /resolvePostLoginRedirect/);
  assert.match(hooks, /handleFetch/);
  assert.match(hooks, /response\.status !== 401/);
  assert.match(hooks, /createLoginRedirectPath/);
  assert.match(auth, /clearAuthSession/);
  assert.match(auth, /URLSearchParams/);
  assert.match(auth, /secure: process\.env\.NODE_ENV === 'production'/);
  assert.match(bootstrap, /available: false/);
  assert.match(layout, /throw error\(503/);
  assert.match(layout, /target === '\/login' \? createLoginRedirectPath\(url\)/);
});

test('admin realtime store reconnects and resubscribes after socket drops', async () => {
  const source = await readFile(path.join(root, 'apps/admin-panel/src/lib/stores/realtime.ts'), 'utf8');
  assert.match(source, /reconnecting/);
  assert.match(source, /reconnectAttempts/);
  assert.match(source, /setTimeout/);
  assert.match(source, /currentChannels/);
  assert.match(source, /currentFilters/);
});

test('dashboard and active study realtime updates avoid self-tracking effect loops', async () => {
  const dashboard = await readRoute('dashboard/+page.svelte');
  const activeStudy = await readRoute('user-studies/[id]/active-study/+page.svelte');

  assert.match(dashboard, /untrack\(\(\) => recentSessions\)/);
  assert.match(dashboard, /untrack\(\(\) => componentHealth\)/);
  assert.doesNotMatch(dashboard, /recentSessions = \[\s*normalized,\s*\.\.\.recentSessions/);
  assert.doesNotMatch(dashboard, /componentHealth = \[\s*normalized,\s*\.\.\.componentHealth/);

  assert.match(activeStudy, /untrack\(\(\) => speedHistory\)/);
  assert.match(activeStudy, /untrack\(\(\) => throttleHistory\)/);
  assert.match(activeStudy, /untrack\(\(\) => brakeHistory\)/);
  assert.doesNotMatch(activeStudy, /speedHistory = \[\.\.\.speedHistory\.slice/);
  assert.doesNotMatch(activeStudy, /throttleHistory = \[\.\.\.throttleHistory\.slice/);
  assert.doesNotMatch(activeStudy, /brakeHistory = \[\.\.\.brakeHistory\.slice/);
});

test('admin shell publishes icon assets for root browser probes', async () => {
  const appHtml = await readFile(path.join(root, 'apps/admin-panel/src/app.html'), 'utf8');

  assert.match(appHtml, /href="\/favicon\.ico"/);
  assert.match(appHtml, /href="\/apple-touch-icon\.png"/);
  assert.match(appHtml, /href="\/apple-touch-icon-precomposed\.png"/);

  for (const assetPath of [
    'apps/admin-panel/static/favicon.ico',
    'apps/admin-panel/static/apple-touch-icon.png',
    'apps/admin-panel/static/apple-touch-icon-precomposed.png'
  ]) {
    await access(path.join(root, assetPath));
  }
});

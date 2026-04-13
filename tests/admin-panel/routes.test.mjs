import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';
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
    'exports/+page.server.ts'
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

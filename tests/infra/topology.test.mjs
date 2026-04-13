import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = '/Users/tugcanonbas/Developer/THI_SHK/the-scarline';
const execFileAsync = promisify(execFile);

test('rabbitmq definitions expose milestone queues and exchanges', async () => {
  const definitions = JSON.parse(await readFile(path.join(root, 'infra/rabbitmq/definitions.json'), 'utf8'));
  const exchanges = new Set(definitions.exchanges.map((exchange) => exchange.name));
  const queues = new Set(definitions.queues.map((queue) => queue.name));

  assert.ok(exchanges.has('scarline.events'));
  assert.ok(exchanges.has('scarline.commands'));
  assert.ok(exchanges.has('scarline.dlx'));
  assert.ok(queues.has('scarline.core-api.events'));
  assert.ok(queues.has('scarline.sim-bridge.commands'));
  assert.ok(queues.has('scarline.io-client.commands'));
});

test('rabbitmq queues are durable and dead-lettered except the terminal DLQ', async () => {
  const definitions = JSON.parse(await readFile(path.join(root, 'infra/rabbitmq/definitions.json'), 'utf8'));
  for (const queue of definitions.queues) {
    assert.equal(queue.durable, true, `${queue.name} should be durable`);
    if (queue.name === 'scarline.dlq') {
      continue;
    }

    assert.equal(queue.arguments?.['x-dead-letter-exchange'], 'scarline.dlx', `${queue.name} should use the DLX`);
  }
});

test('scarline launcher advertises required commands and IPC socket', async () => {
  const script = await readFile(path.join(root, 'scarline'), 'utf8');
  assert.match(script, /start\|stop\|restart\|status\|logs\|reset-db/);
  assert.match(script, /\/tmp\/scarline\.sock/);
  assert.match(script, /ipc_server\.py/);
  assert.match(script, /core-api sim-bridge admin-panel overlay-web docs io-client nginx/);
  assert.match(script, /open_admin_ui/);
  assert.match(script, /wait_for_health core-api sim-bridge admin-panel overlay-web nginx/);
  assert.match(script, /OVERLAY_CONTROL_PORT/);
  assert.match(script, /validate_port_available/);
  assert.match(script, /supervisor_loop/);
  assert.match(script, /start_supervisor/);
});

test('windows launcher advertises command parity and no-carla mode', async () => {
  const script = await readFile(path.join(root, 'scarline.ps1'), 'utf8');
  assert.match(script, /ValidateSet\("start", "stop", "restart", "status", "logs", "reset-db"\)/);
  assert.match(script, /\[switch\]\$NoCarla/);
  assert.match(script, /docker compose/);
  assert.match(script, /admin\/dashboard/);
  assert.match(script, /Start-OverlayDesktop/);
  assert.match(script, /PM_SOCKET_PATH/);
  assert.match(script, /tcp:\/\/127\.0\.0\.1:4098/);
});

test('database schema includes PRD foundation tables and columns', async () => {
  const schema = await readFile(path.join(root, 'infra/database/schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS study_trigger_rules/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS session_summaries/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS activity_log/);
  assert.match(schema, /ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_configuration/);
  assert.match(schema, /ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS parameters/);
});

test('nginx exposes PRD-aligned single-domain routing', async () => {
  const config = await readFile(path.join(root, 'infra/nginx/default.conf'), 'utf8');
  assert.match(config, /absolute_redirect off;/);
  assert.match(config, /return 302 \/admin\/dashboard;/);
  assert.match(config, /location \/admin\//);
  assert.match(config, /location \/docs\//);
  assert.match(config, /location \/overlay\//);
  assert.match(config, /location \/rabbitmq\//);
});

test('process manager ipc can relay overlay reloads to electron control endpoint', async () => {
  const source = await readFile(path.join(root, 'infra/process-manager/ipc_server.py'), 'utf8');
  assert.match(source, /OVERLAY_CONTROL_PORT/);
  assert.match(source, /\/overlay\/reload/);
  assert.match(source, /urllib\.request/);
  assert.match(source, /TcpHTTPServer/);
  assert.match(source, /_start_carla/);
  assert.match(source, /_docker_status/);
});

test('desktop overlay exposes health and reload control hooks', async () => {
  const source = await readFile(path.join(root, 'apps/desktop-overlay/src/main.mjs'), 'utf8');
  assert.match(source, /OVERLAY_CONTROL_PORT/);
  assert.match(source, /\/health/);
  assert.match(source, /\/reload/);
  assert.match(source, /setIgnoreMouseEvents/);
  assert.match(source, /screen\.getAllDisplays/);
  assert.match(source, /render-process-gone/);
});

test('overlay web exposes widget validation and relative gateway assets', async () => {
  const source = await readFile(path.join(root, 'apps/overlay-web/src/server.ts'), 'utf8');
  assert.match(source, /\/validate/);
  assert.match(source, /validateWidgetMetadata/);
  assert.match(source, /src="\.\/app\.js"/);
});

test('scarline preserves CARLA paths and skips CARLA validation in --no-carla mode', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'scarline-launcher-'));

  try {
    const configPath = path.join(tempDir, '.scarline.yaml');
    const harnessPath = path.join(tempDir, 'scarline-harness.sh');
    const script = await readFile(path.join(root, 'scarline'), 'utf8');

    await writeFile(
      configPath,
      ['carla:', '  server_path: /opt/carla/CarlaUE4.sh', '  server_port: 2000'].join('\n')
    );
    await writeFile(harnessPath, script.replace(/\nmain "\$@"\s*$/, '\n'));

    const { stdout } = await execFileAsync(
      'bash',
      [
        '-lc',
        'source "$1"; CONFIG_FILE="$2"; validate_port_available(){ :; }; load_config; [[ "$CARLA_SERVER_PATH" == "/opt/carla/CarlaUE4.sh" ]]; NO_CARLA=true; validate_prerequisites; printf "%s" "$CARLA_SERVER_PATH"',
        '--',
        harnessPath,
        configPath
      ],
      { cwd: root }
    );

    assert.equal(stdout, '/opt/carla/CarlaUE4.sh');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('scarline compose wrapper forwards compose files and subcommands', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'scarline-compose-'));

  try {
    const harnessPath = path.join(tempDir, 'scarline-harness.sh');
    const script = await readFile(path.join(root, 'scarline'), 'utf8');

    await writeFile(harnessPath, script.replace(/\nmain "\$@"\s*$/, '\n'));

    const { stdout } = await execFileAsync(
      'bash',
      [
        '-lc',
        'source "$1"; ROOT_DIR="$2"; DEV_MODE=true; docker(){ printf "%s\\n" "$@"; }; compose ps --format json',
        '--',
        harnessPath,
        root
      ],
      { cwd: root }
    );

    const args = stdout.trim().split('\n');
    assert.deepEqual(args, [
      'compose',
      '-f',
      path.join(root, 'docker-compose.yml'),
      '-f',
      path.join(root, 'docker-compose.dev.yml'),
      'ps',
      '--format',
      'json'
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

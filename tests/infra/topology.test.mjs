import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  assert.match(script, /wait_for_health core-api sim-bridge admin-panel overlay-web docs io-client nginx/);
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
  assert.match(schema, /refresh_session_summary_after_event/);
  assert.match(schema, /refresh_session_summary_after_session_change/);
  assert.match(schema, /ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_configuration/);
  assert.match(schema, /ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS parameters/);
  assert.match(schema, /requested_by UUID REFERENCES users/);
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

test('compose defines internal health checks for mock simulator and io client', async () => {
  const compose = await readFile(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /mock-simulator:/);
  assert.match(compose, /MOCK_HEALTH_PORT: 8082/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:8082\/health/);
  assert.match(compose, /io-client:/);
  assert.match(compose, /IO_HEALTH_PORT: 8081/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:8081\/health/);
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
  assert.match(source, /acceptFirstMouse:\s*true/);
  assert.match(source, /movable:\s*true/);
  assert.match(source, /resizable:\s*!transparent/);
  assert.match(source, /backgroundMaterial:\s*transparent \? 'none' : undefined/);
  assert.match(source, /setBackgroundColor\('#00000000'\)/);
  assert.match(source, /minWidth/);
  assert.match(source, /minHeight/);
  assert.match(source, /setMinimumSize/);
  assert.match(source, /setFocusable\(process\.env\.OVERLAY_FOCUSABLE === 'true'\)/);
  assert.match(source, /windowRef\.showInactive\(\)/);
  assert.match(source, /windowRef\.on\('move'/);
  assert.match(source, /windowRef\.on\('resize'/);
  assert.match(source, /screen\.getAllDisplays/);
  assert.match(source, /render-process-gone/);
});

test('overlay web exposes widget validation and relative gateway assets', async () => {
  const source = await readFile(path.join(root, 'apps/overlay-web/src/server.ts'), 'utf8');
  assert.match(source, /\/validate/);
  assert.match(source, /validateWidgetMetadata/);
  assert.match(source, /src="\/overlay\/app\.js"/);
  assert.match(source, /\/overlay\/assets\/:widgetId\/:file/);
  assert.match(source, /__SCARLINE_OVERLAY_CONTROL_ORIGIN/);
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

test('scarline launcher validates node and pnpm requirements before startup', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'scarline-reqs-'));
  try {
    const harnessPath = path.join(tempDir, 'scarline-harness.sh');
    const script = await readFile(path.join(root, 'scarline'), 'utf8');
    await writeFile(harnessPath, script.replace(/\nmain "\$@"\s*$/, '\n'));

    // Test outdated node (v14)
    try {
      await execFileAsync('bash', ['-lc', 'source "$1"; node(){ echo "v14.0.0"; }; check_runtime_requirements', '--', harnessPath], { cwd: root });
      assert.fail('Should have failed for old node version');
    } catch (err) {
      assert.match(err.stderr, /Node\.js version 20 or higher is required/);
    }

    // Test missing pnpm
    const mockBin = path.join(tempDir, 'mock-bin');
    await execFileAsync('mkdir', [mockBin]);
    // Create a mock node that passes the version check
    await writeFile(path.join(mockBin, 'node'), '#!/bin/sh\necho "v20.0.0"', { mode: 0o755 });
    
    try {
      // Use mockBin first in PATH, and include basic system paths for 'cut', 'sed' etc.
      // We explicitly DO NOT include the real pnpm path.
      await execFileAsync('bash', ['-lc', 'source "$1"; export PATH="$2:/usr/bin:/bin"; check_runtime_requirements', '--', harnessPath, mockBin], { cwd: root });
      assert.fail('Should have failed for missing pnpm');
    } catch (err) {
      assert.ok(err.stderr, 'stderr should be defined');
      assert.match(err.stderr, /pnpm is not installed/);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('launcher correctly configures IPC socket paths for cross-platform fallback', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'scarline-ipc-'));
  try {
    const harnessPath = path.join(tempDir, 'scarline-harness.sh');
    const script = await readFile(path.join(root, 'scarline'), 'utf8');
    await writeFile(harnessPath, script.replace(/\nmain "\$@"\s*$/, '\n'));

    // Test macOS (Darwin) TCP fallback
    const { stdout: macOut } = await execFileAsync(
      'bash',
      ['-lc', 'source "$1"; uname(){ echo "Darwin"; }; PM_CONTROL_PORT=9999; load_config; printf "%s" "$SOCKET_PATH"', '--', harnessPath],
      { cwd: root }
    );
    assert.equal(macOut, 'tcp://127.0.0.1:9999');

    // Test Linux socket path
    const { stdout: linuxOut } = await execFileAsync(
      'bash',
      ['-lc', 'source "$1"; uname(){ echo "Linux"; }; load_config; printf "%s" "$SOCKET_PATH"', '--', harnessPath],
      { cwd: root }
    );
    assert.equal(linuxOut, '/tmp/scarline.sock');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('launcher and compose configure internal status auth, dev seed, and healthy gateway dependencies', async () => {
  const launcher = await readFile(path.join(root, 'scarline'), 'utf8');
  const compose = await readFile(path.join(root, 'docker-compose.yml'), 'utf8');

  assert.match(launcher, /SCARLINE_INTERNAL_API_TOKEN/);
  assert.match(launcher, /x-scarline-internal-token/);
  assert.match(launcher, /COMPOSE_PROFILES=.*dev/);
  assert.match(compose, /SCARLINE_INTERNAL_API_TOKEN/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /127\.0\.0\.1:4040/);
});

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

test('scarline launcher advertises required commands and IPC socket', async () => {
  const script = await readFile(path.join(root, 'scarline'), 'utf8');
  assert.match(script, /start\|stop\|restart\|status\|logs\|reset-db/);
  assert.match(script, /\/tmp\/scarline\.sock/);
  assert.match(script, /ipc_server\.py/);
  assert.match(script, /core-api sim-bridge admin-panel overlay-web docs io-client nginx/);
  assert.match(script, /open_admin_ui/);
});

test('nginx root redirect preserves the incoming host and port', async () => {
  const config = await readFile(path.join(root, 'infra/nginx/default.conf'), 'utf8');
  assert.match(config, /absolute_redirect off;/);
  assert.match(config, /return 302 \/dashboard;/);
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
        'source "$1"; CONFIG_FILE="$2"; load_config; [[ "$CARLA_SERVER_PATH" == "/opt/carla/CarlaUE4.sh" ]]; NO_CARLA=true; validate_prerequisites; printf "%s" "$CARLA_SERVER_PATH"',
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

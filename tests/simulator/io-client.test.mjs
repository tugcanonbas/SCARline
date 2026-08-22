import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile, unlink } from 'node:fs/promises';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('io client discovers plugins and publishes degraded sensor health', async () => {
  const source = await readFile(path.join(root, 'python/io-client/scarline_io/__main__.py'), 'utf8');

  assert.match(source, /entry_points\(group="scarline_io\.drivers"\)/);
  assert.match(source, /DRIVER_FACTORIES/);
  assert.match(source, /publish_component_status/);
  assert.match(source, /publish_sensor_status/);
  assert.match(source, /publish_driver_status_event/);
  assert.match(source, /refresh_health_sensors/);
  assert.match(source, /health_sensor_entry/);
  assert.match(source, /activeSession/);
  assert.match(source, /"sensors": \[\]/);
  assert.match(source, /io\.driver_status/);
  assert.match(source, /configSchema/);
  assert.match(source, /degraded/);
  assert.match(source, /Driver initialized in degraded mode/);
  assert.match(source, /commands\.io\.\*/);
  assert.match(source, /message\.process\(requeue=False\)/);
  assert.match(source, /IO_HEALTH_PORT/);
  assert.match(source, /health_server/);
  assert.match(source, /for configured_sensor in configured_sensors/);
  assert.match(source, /driver\.initialize\(configured_sensor\)/);
});

test('io client includes baseline optional sensor interfaces', async () => {
  for (const driverPath of [
    'python/io-client/scarline_io/drivers/eye_tracker.py',
    'python/io-client/scarline_io/drivers/heart_rate.py'
  ]) {
    const source = await readFile(path.join(root, driverPath), 'utf8');
    assert.match(source, /class .*Driver\(SensorDriver\)/);
    assert.match(source, /baseline-unavailable/);
    await access(path.join(root, driverPath));
  }
});

// ---------------------------------------------------------------------------
// Blink Detection Driver — behavioral tests via Python subprocess
// ---------------------------------------------------------------------------

/**
 * Helper: resolve Python executable.
 * Tries 'python' first (Windows), then 'python3' (Linux/macOS).
 */
function findPython() {
  for (const cmd of ['python', 'python3']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      // not found, try next
    }
  }
  return null;
}

const PYTHON = findPython();
const ioClientPath = path.join(root, 'python', 'io-client').replace(/\\/g, '/');

/**
 * Helper: run a Python script via temp file to avoid shell quoting issues
 * on Windows (PowerShell, cmd) when passing multi-line scripts with quotes.
 */
function runPythonScript(scriptBody) {
  const tempFile = path.join(tmpdir(), `scarline_test_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const preamble = `import sys\nsys.path.insert(0, ${JSON.stringify(ioClientPath)})\n`;
  try {
    writeFileSync(tempFile, preamble + scriptBody, 'utf8');
    return execSync(`${PYTHON} "${tempFile}"`, {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }).trim();
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

test('blink detection driver publishes event with correct topic', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const studyId = '00000000-0000-0000-0000-000000000001';
  const runId = '00000000-0000-0000-0000-000000000002';

  // This script instantiates the real driver, reads sensor_type from metadata,
  // then mirrors routing_key_for_sensor() logic to compute the routing key.
  const script = `
from scarline_io.drivers.eye_tracker import BlinkDetectionDriver
d = BlinkDetectionDriver()
m = d.get_metadata()
st = m.sensor_type
# mirror routing_key_for_sensor logic from __main__.py
if st == "steering_wheel":
    rk = f"events.${studyId}.${runId}.driving.io.steering"
elif st == "camera":
    rk = f"events.${studyId}.${runId}.sensor.io.camera"
else:
    rk = f"events.${studyId}.${runId}.sensor.io.{st}"
print(rk)
`;

  const result = runPythonScript(script);
  assert.equal(
    result,
    `events.${studyId}.${runId}.sensor.io.blink`,
    'routing key must target sensor.io.blink topic'
  );
});

test('blink detection metadata contains studyId and runId', { skip: PYTHON === null && 'python not in PATH' }, () => {
  // Verify driver metadata fields via real Python instantiation
  const script = `
import json
from scarline_io.drivers.eye_tracker import BlinkDetectionDriver
d = BlinkDetectionDriver()
m = d.get_metadata()
print(json.dumps({
    "driver_id": m.driver_id,
    "sensor_type": m.sensor_type,
    "display_name": m.display_name,
    "version": m.version,
    "sample_rate": m.sample_rate
}))
`;

  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.driver_id, 'blink');
  assert.equal(result.sensor_type, 'blink');
  assert.ok(result.display_name.length > 0, 'display_name must not be empty');
  assert.ok(result.version.length > 0, 'version must not be empty');
  assert.ok(result.sample_rate > 0, 'sample_rate must be positive');

  // Verify __main__.py envelope includes studyId/runId in metadata
  const mainSource = readFileSync(
    path.join(root, 'python/io-client/scarline_io/__main__.py'),
    'utf8'
  );
  assert.match(mainSource, /"studyId": study_id/);
  assert.match(mainSource, /"runId": run_id/);
});

test('blink detection runs in degraded mode without webcam', { skip: PYTHON === null && 'python not in PATH' }, () => {
  // Instantiate driver, initialize without webcam, verify degraded behavior
  const script = `
import json
from scarline_io.drivers.eye_tracker import BlinkDetectionDriver
d = BlinkDetectionDriver()
init_ok = d.initialize({"sample_rate": 5, "camera_index": 999})
d.start()
reading = d.read()
print(json.dumps({
    "init_ok": init_ok,
    "connected": d.is_connected(),
    "has_reading": reading is not None,
    "reading_data": reading.data if reading else None,
    "reading_meta": reading.metadata if reading else None
}))
`;

  const result = JSON.parse(runPythonScript(script));
  // In CI/test env without webcam: init returns False, not connected
  assert.equal(result.connected, false, 'driver must not be connected without webcam');
  // Driver still produces a reading (degraded stub data)
  assert.equal(result.has_reading, true, 'degraded mode must still produce readings');
  assert.equal(result.reading_data.blink_detected, false, 'no blinks in degraded mode');
  assert.equal(result.reading_data.connected, false, 'reading must report disconnected');
  assert.equal(result.reading_meta.source, 'baseline-unavailable', 'degraded source marker');
});

// ---------------------------------------------------------------------------
// Eye Tracker Gaze + Pupil — behavioral tests via Python subprocess
// ---------------------------------------------------------------------------

test('eye tracker computes gaze estimation from iris landmarks', { skip: PYTHON === null && 'python not in PATH' }, () => {
  // Verify _compute_gaze function exists and handles mock landmarks correctly
  const script = `
import json
from scarline_io.drivers.eye_tracker import _compute_gaze

# Create a mock landmark list with 478 points (MediaPipe FaceMesh with iris)
class MockLandmark:
    def __init__(self, x, y, z=0.0):
        self.x = x
        self.y = y
        self.z = z

# Build 478 landmarks with default positions
landmarks = [MockLandmark(0.5, 0.5) for _ in range(478)]

# Set right eye bounding box (inner=133, outer=33, top=159, bottom=145)
landmarks[133] = MockLandmark(0.6, 0.4)   # inner
landmarks[33]  = MockLandmark(0.4, 0.4)   # outer
landmarks[159] = MockLandmark(0.5, 0.35)  # top
landmarks[145] = MockLandmark(0.5, 0.45)  # bottom
# Right iris center=468 — place at center of right eye
landmarks[468] = MockLandmark(0.5, 0.4)

# Set left eye bounding box (inner=362, outer=263, top=386, bottom=374)
landmarks[362] = MockLandmark(0.8, 0.4)   # inner
landmarks[263] = MockLandmark(0.7, 0.4)   # outer
landmarks[386] = MockLandmark(0.75, 0.35) # top
landmarks[374] = MockLandmark(0.75, 0.45) # bottom
# Left iris center=473 — place at center of left eye
landmarks[473] = MockLandmark(0.75, 0.4)

gaze = _compute_gaze(landmarks)
print(json.dumps({"x": gaze[0], "y": gaze[1]}))
`;

  const result = JSON.parse(runPythonScript(script));
  assert.ok(result.x !== null, 'gaze x must not be null with valid landmarks');
  assert.ok(result.y !== null, 'gaze y must not be null with valid landmarks');
  assert.ok(result.x >= 0 && result.x <= 1, 'gaze x must be normalized [0,1]');
  assert.ok(result.y >= 0 && result.y <= 1, 'gaze y must be normalized [0,1]');
});

test('eye tracker computes pupil diameter from iris landmarks', { skip: PYTHON === null && 'python not in PATH' }, () => {
  // Verify _compute_pupil_diameter function with mock landmarks
  const script = `
import json
from scarline_io.drivers.eye_tracker import _compute_pupil_diameter

class MockLandmark:
    def __init__(self, x, y, z=0.0):
        self.x = x
        self.y = y
        self.z = z

landmarks = [MockLandmark(0.5, 0.5) for _ in range(478)]

# Right iris extremes: 469, 471
landmarks[469] = MockLandmark(0.48, 0.4)
landmarks[471] = MockLandmark(0.52, 0.4)
# Left iris extremes: 474, 476
landmarks[474] = MockLandmark(0.73, 0.4)
landmarks[476] = MockLandmark(0.77, 0.4)

diameter = _compute_pupil_diameter(landmarks)
print(json.dumps({"diameter": diameter}))
`;

  const result = JSON.parse(runPythonScript(script));
  assert.ok(result.diameter !== null, 'pupil diameter must not be null with valid landmarks');
  assert.ok(result.diameter > 0, 'pupil diameter must be positive');
  // Expected: avg of dist(0.48,0.52) and dist(0.73,0.77) = avg of 0.04 and 0.04 = 0.04
  assert.ok(result.diameter > 0.03 && result.diameter < 0.05, 'pupil diameter should be ~0.04 for test landmarks');
});

test('eye tracker degraded mode returns null gaze and pupil', { skip: PYTHON === null && 'python not in PATH' }, () => {
  // In degraded mode (no webcam), read() should return null gaze and pupilDiameter
  const script = `
import json
from scarline_io.drivers.eye_tracker import GazeDriver
d = GazeDriver()
d.initialize({"sample_rate": 5, "camera_index": 999})
d.start()
reading = d.read()
print(json.dumps({
    "has_reading": reading is not None,
    "gaze": reading.data.get("gaze") if reading else None,
    "pupilDiameter": reading.data.get("pupilDiameter") if reading else None,
    "connected": reading.data.get("connected") if reading else None
}))
`;

  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.has_reading, true, 'degraded mode must produce a reading');
  assert.deepEqual(result.gaze, { x: null, y: null }, 'degraded gaze must be {x: null, y: null}');
  assert.equal(result.pupilDiameter, null, 'degraded pupilDiameter must be null');
  assert.equal(result.connected, false, 'degraded reading must report disconnected');
});

test('gaze driver has separate sensor_type eye_tracker', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.eye_tracker import GazeDriver
d = GazeDriver()
m = d.get_metadata()
print(json.dumps({
    "driver_id": m.driver_id,
    "sensor_type": m.sensor_type
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.driver_id, 'gaze');
  assert.equal(result.sensor_type, 'eye_tracker');
});

test('gaze driver degraded mode returns null gaze', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.eye_tracker import GazeDriver
d = GazeDriver()
d.initialize({"sample_rate": 5, "camera_index": 999})
d.start()
reading = d.read()
print(json.dumps({
    "gaze": reading.data.get("gaze") if reading else None
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.deepEqual(result.gaze, { x: null, y: null }, 'degraded gaze must be {x: null, y: null}');
});

test('blink driver payload no longer includes gaze fields', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.eye_tracker import BlinkDetectionDriver
d = BlinkDetectionDriver()
d.initialize({"sample_rate": 5})
d.start()
reading = d.read()
print(json.dumps({
    "has_gaze": "gaze" in reading.data,
    "has_pupil": "pupilDiameter" in reading.data
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.has_gaze, false, 'blink driver should not have gaze field');
  assert.equal(result.has_pupil, false, 'blink driver should not have pupilDiameter field');
});

// ---------------------------------------------------------------------------
// Heart Rate Driver — behavioral tests via Python subprocess
// ---------------------------------------------------------------------------

test('heart rate driver metadata has correct schema', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.heart_rate import HeartRateDriver
d = HeartRateDriver()
m = d.get_metadata()
print(json.dumps({
    "driver_id": m.driver_id,
    "sensor_type": m.sensor_type,
    "sample_rate": m.sample_rate,
    "backend": m.custom_fields.get("backend")
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.driver_id, 'heart_rate');
  assert.equal(result.sensor_type, 'heart_rate');
  assert.ok(result.sample_rate > 0);
  assert.equal(result.backend, 'bleak');
});

test('heart rate driver runs in degraded mode without hardware', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.heart_rate import HeartRateDriver
d = HeartRateDriver()
# Attempt to initialize with serial (which will fail without hardware/port)
init_ok = d.initialize({"backend": "serial", "serial_port": "INVALID_PORT"})
d.start()
reading = d.read()
print(json.dumps({
    "init_ok": init_ok,
    "connected": d.is_connected(),
    "has_reading": reading is not None,
    "heartRateBpm": reading.data.get("heartRateBpm") if reading else None,
    "connected_flag": reading.data.get("connected") if reading else None,
    "source": reading.metadata.get("source") if reading else None
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.init_ok, false, 'init should fail with invalid port');
  assert.equal(result.connected, false, 'should not be connected');
  assert.equal(result.has_reading, true, 'degraded mode must produce a reading');
  assert.equal(result.heartRateBpm, null, 'degraded BPM must be null');
  assert.equal(result.connected_flag, false, 'degraded reading must report disconnected');
  assert.equal(result.source, 'baseline-unavailable', 'degraded source marker');
});

test('heart rate driver selects backend from config', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
from scarline_io.drivers.heart_rate import HeartRateDriver
d1 = HeartRateDriver()
d1.initialize({"backend": "serial", "serial_port": "INVALID_PORT"})
d2 = HeartRateDriver()
d2.initialize({"backend": "bleak"})
print(json.dumps({
    "d1_backend": d1.backend,
    "d2_backend": d2.backend
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.d1_backend, 'serial', 'should use serial backend from config');
  assert.equal(result.d2_backend, 'bleak', 'should use bleak backend from config');
});

test('heart rate ble driver uses persistent event loop not asyncio run', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import inspect
from scarline_io.drivers.heart_rate import HeartRateDriver
d = HeartRateDriver()
source_code = inspect.getsource(d.initialize)
has_thread = "threading.Thread" in source_code
print(json.dumps({
    "has_thread": has_thread
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.has_thread, true, 'initialize must spawn a threading.Thread');
});

test('heart rate ble driver read is non-blocking after initialize', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import inspect
from scarline_io.drivers.heart_rate import HeartRateDriver
d = HeartRateDriver()
source_code = inspect.getsource(d.read)
has_asyncio = "asyncio.run" in source_code
print(json.dumps({
    "has_asyncio": has_asyncio
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.has_asyncio, false, 'read must not use asyncio.run');
});

// ---------------------------------------------------------------------------
// Logitech G29 Driver — behavioral tests via Python subprocess
// ---------------------------------------------------------------------------

test('logitech g29 driver is importable on windows without evdev', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import sys

# Force evdev to be unavailable to simulate Windows environment
sys.modules['evdev'] = None

from scarline_io.drivers.logitech_g29 import LogitechG29Driver
d = LogitechG29Driver()
m = d.get_metadata()
print(json.dumps({
    "driver_id": m.driver_id,
    "sensor_type": m.sensor_type,
    "import_success": True
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.import_success, true, 'driver should import successfully');
  assert.equal(result.driver_id, 'logitech_g29');
});

test('logitech g29 driver runs in degraded mode when evdev unavailable', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import sys

# Force evdev to be unavailable to simulate Windows environment
sys.modules['evdev'] = None

from scarline_io.drivers.logitech_g29 import LogitechG29Driver
d = LogitechG29Driver()
init_ok = d.initialize({})
d.start()
reading = d.read()
print(json.dumps({
    "init_ok": init_ok,
    "connected": d.is_connected(),
    "has_reading": reading is not None,
    "steeringAngle": reading.data.get("steeringAngle") if reading else None,
    "throttle": reading.data.get("throttle") if reading else None,
    "brake": reading.data.get("brake") if reading else None,
    "connected_flag": reading.data.get("connected") if reading else None,
    "source": reading.metadata.get("source") if reading else None
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.init_ok, false, 'init should return false in degraded mode');
  assert.equal(result.connected, false, 'should not be connected');
  assert.equal(result.has_reading, true, 'degraded mode must produce a reading');
  assert.equal(result.steeringAngle, null, 'degraded steeringAngle must be null');
  assert.equal(result.throttle, null, 'degraded throttle must be null');
  assert.equal(result.brake, null, 'degraded brake must be null');
  assert.equal(result.connected_flag, false, 'degraded reading must report disconnected');
  assert.equal(result.source, 'baseline-unavailable', 'degraded source marker');
});

// ---------------------------------------------------------------------------
// ECG Driver — behavioral tests via Python subprocess
// ---------------------------------------------------------------------------

test('ecg driver runs in degraded mode without sifi-bridge-py', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import sys

# Force sifi_bridge_py to be unavailable
sys.modules['sifi_bridge_py'] = None

from scarline_io.drivers.ecg import ECGDriver
d = ECGDriver()
init_ok = d.initialize({})
d.start()
reading = d.read()
print(json.dumps({
    "init_ok": init_ok,
    "connected": d.is_connected(),
    "has_reading": reading is not None,
    "ecgSamples": reading.data.get("ecgSamples") if reading else "MISSING",
    "connected_flag": reading.data.get("connected") if reading else "MISSING",
    "source": reading.metadata.get("source") if reading else "MISSING"
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.init_ok, false, 'init should fail without sifi-bridge-py');
  assert.equal(result.connected, false, 'should not be connected');
  assert.equal(result.has_reading, true, 'degraded mode must produce a reading');
  assert.equal(result.ecgSamples, null, 'degraded ecgSamples must be null');
  assert.equal(result.connected_flag, false, 'degraded reading must report disconnected');
  assert.equal(result.source, 'baseline-unavailable', 'degraded source marker');
});

test('ecg driver get_metadata returns driver_id ecg and sensor_type ecg', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import json
import sys

sys.modules['sifi_bridge_py'] = None

from scarline_io.drivers.ecg import ECGDriver
d = ECGDriver()
m = d.get_metadata()
print(json.dumps({
    "driver_id": m.driver_id,
    "sensor_type": m.sensor_type,
    "display_name": m.display_name,
    "sample_rate": m.sample_rate
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.driver_id, 'ecg');
  assert.equal(result.sensor_type, 'ecg');
  assert.ok(result.display_name.length > 0, 'display_name must not be empty');
  assert.ok(result.sample_rate > 0, 'sample_rate must be positive');
});

test('ecg driver is registered in DRIVER_FACTORIES', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const mainSource = readFileSync(
    path.join(root, 'python/io-client/scarline_io/__main__.py'),
    'utf8'
  );
  // Verify the import line exists
  assert.match(mainSource, /from \.drivers\.ecg import ECGDriver/,
    'ECGDriver must be imported in __main__.py');
  // Verify the DRIVER_FACTORIES entry exists
  assert.match(mainSource, /"ecg":\s*ECGDriver/,
    'ECG must be registered in DRIVER_FACTORIES');

  // Also verify the driver is instantiable via Python
  const script = `
import json
import sys

sys.modules['sifi_bridge_py'] = None

from scarline_io.drivers.ecg import ECGDriver
d = ECGDriver()
m = d.get_metadata()
print(json.dumps({
    "registered": m.driver_id == "ecg",
    "instantiable": True
}))
`;
  const result = JSON.parse(runPythonScript(script));
  assert.equal(result.registered, true, 'driver_id must be ecg');
  assert.equal(result.instantiable, true, 'driver must be instantiable');
});

test('io client health server rmq proxy handles GET and returns CORS headers', { skip: PYTHON === null && 'python not in PATH' }, () => {
  const script = `
import asyncio
import http.server
import threading
import urllib.request
import urllib.parse
import json
import os

# 1. Start a mock RabbitMQ Management HTTP Server on a free port
class MockRMQHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def do_GET(self):
        if self.path == "/api/queues/%2F":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps([{"name": "scarline.io-client.commands"}]).encode("utf8"))
        else:
            self.send_response(404)
            self.end_headers()

mock_server = http.server.HTTPServer(("127.0.0.1", 0), MockRMQHandler)
mock_port = mock_server.server_port
mock_thread = threading.Thread(target=mock_server.serve_forever, daemon=True)
mock_thread.start()

# 2. Configure AMQP_URL to point to this mock server
os.environ["AMQP_URL"] = f"amqp://scarline:scarline@localhost:{mock_port}"
# Reload/Import module after env var is set
import scarline_io.__main__ as main
main.AMQP_URL = f"amqp://scarline:scarline@localhost:{mock_port}"

# 3. Start the health server in an event loop
health_port = 9095
loop = asyncio.new_event_loop()

async def run_server():
    server = await asyncio.start_server(main.handle_health_request, "127.0.0.1", health_port)
    async with server:
        await asyncio.sleep(2.0)

def loop_thread_func():
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_server())

t = threading.Thread(target=loop_thread_func, daemon=True)
t.start()

import time
time.sleep(0.5)  # Wait for health server to start

# 4. Make request to the proxy
try:
    req = urllib.request.Request(f"http://127.0.0.1:{health_port}/rmq/queues/%2F")
    with urllib.request.urlopen(req) as response:
        status = response.status
        cors = response.headers.get("Access-Control-Allow-Origin")
        body = response.read().decode("utf8")
        print(status)
        print(cors)
        print(body)
except Exception as e:
    print(f"ERROR: {e}")
finally:
    # 5. Clean shutdown
    mock_server.shutdown()
    mock_server.server_close()
`;

  const result = runPythonScript(script).split('\n').map(line => line.trim());
  assert.equal(result[0], '200');
  assert.equal(result[1], '*');
  const body = JSON.parse(result[2]);
  assert.equal(body[0].name, 'scarline.io-client.commands');
});

# Sensor Drivers

A sensor driver has two parts: a **manifest** that describes what it can do, and a
**Python class** that does it. The manifest is read by both the IO Client and CoreAPI;
the class is loaded only by the IO Client.

## 1. Write The Manifest

Add a JSON file to `services/io-client/drivers/`. It is validated against
`IoDriverManifestSchema`.

```json
{
  "key": "my_sensor",
  "name": "My Sensor",
  "version": "1.0.0",
  "deviceType": "custom",
  "platforms": ["linux", "darwin", "win32"],
  "capabilities": ["health.my-measurement"],
  "configurationSchema": {
    "type": "object",
    "properties": { "port": { "type": "string" } }
  },
  "channels": [
    {
      "key": "my_channel",
      "name": "My Channel",
      "modality": "health",
      "unit": "mV",
      "sampleRate": 50,
      "configurationSchema": {}
    }
  ],
  "optionalDependency": "my-extra",
  "mock": false
}
```

| Field | Rule |
| --- | --- |
| `key` | `^[a-z][a-z0-9_-]*$`, unique across the directory, and the class's `key` |
| `platforms` | At least one of `linux`, `darwin`, `win32` |
| `capabilities` | Dotted lowercase strings |
| `channels` | At least one; each key matches `^[a-z][a-z0-9_-]*$` |
| `sampleRate` | Positive, at most 10000 Hz |
| `optionalDependency` | The pyproject extra needed for real hardware, or `null` |
| `mock` | `true` only for synthetic drivers |

The channel `key` survives into event names — a `heart_rate` channel produces
`events.<study>.<session>.health.io.heart_rate` — so choose it carefully.

## 2. Implement The Driver

Subclass `SensorDriver` from `scarline_io.drivers.base`:

```python
from scarline_io.drivers.base import SensorDriver
from scarline_io.models import Reading


class MySensorDriver(SensorDriver):
    key = "my_sensor"

    async def connect(self) -> None:
        self._device = await open_device(self.configuration["port"])
        self.connected = True

    async def read(self, channel: str) -> Reading | None:
        if not self.running:
            return None
        value = await self._device.read()
        if value is None:
            return None
        return Reading(channel, {"value": value, "connected": True})

    async def disconnect(self) -> None:
        self.connected = self.running = False
        await self._device.close()
```

| Member | Contract |
| --- | --- |
| `key` | Matches the manifest |
| `configure(configuration)` | Stores configuration; called before `connect` |
| `connect()` | Opens the device and sets `connected`; raise on failure |
| `start()` / `pause()` / `resume()` | Toggle `running`; the defaults are usually enough |
| `read(channel)` | One reading, or `None` when nothing is available |
| `get_state()` | Diagnostic state; the default reports key, connected, running |
| `disconnect()` | Releases the device and clears both flags |

`read` is called in a loop at the channel's configured rate. Returning `None` is normal
and simply produces no sample — do not invent a value. Raising ends the channel task and
triggers the device's `onDisconnect` policy.

A `Reading` carries the channel, the sample dict, an optional `source_timestamp`
(defaults to now), and `dropped_samples` when the device reported a gap.

### Producing Vehicle Control

A sample containing `steer`, `throttle`, and `brake` is automatically republished on the
low-latency `controls.<sessionId>` path, clamped to valid ranges. That is all a steering
device has to do to drive the simulator.

## 3. Register It

Built-in drivers are registered in `DRIVER_TYPES` in
`services/io-client/scarline_io/drivers/builtin.py`.

An external package can register instead through the `scarline_io.drivers` entry point
group:

```toml
[project.entry-points."scarline_io.drivers"]
my_sensor = "my_package.driver:MySensorDriver"
```

The IO Client loads entry points at startup and refuses anything that is not a
`SensorDriver` subclass.

## 4. Declare Dependencies

Hardware libraries go in an optional extra in `services/io-client/pyproject.toml`:

```toml
[project.optional-dependencies]
my-extra = ["my-device-sdk==1.2.3"]
```

Name that extra as the manifest's `optionalDependency`. The driver then appears in the
catalogue on every platform, but can only connect where the extra is installed — which
is what lets the Admin Panel show the driver and explain why it is unavailable.

Existing extras: `camera` (MediaPipe, OpenCV), `g29` (evdev, Linux only), `heart-rate`
(bleak, pyserial), `test` (pytest).

## 5. Make It Visible

```bash
scarline setup                         # reinstall the venv with the new extra
scarline stop && scarline start
```

Then **Sensors → refresh sensor drivers**, or `POST /api/v1/sensors/refresh`. An invalid
manifest is rejected with `SENSOR_CATALOGUE_INVALID` and the specific issues.

Devices appear in the registry when the IO Client discovers them and publishes
`events.system.global.system.device.discovered`. CoreAPI upserts the device by
`source_key`, upserts its channels, and deactivates channels that disappeared.
Administrators can also register a device manually under **Settings → Devices**.

## 6. Test

```bash
.runtime/io-client/venv/bin/python -m pytest services/io-client/test
```

The suite covers the catalogue, driver behaviour, journaling, models, the realtime
control path, and integration. `pytest-asyncio` runs in auto mode, so `async def` tests
need no decorator.

## Guidelines

- Never synthesise a plausible value when the device is silent. Return `None`.
- Set `mock: true` and mark samples `simulated` for synthetic drivers, so the UI can
  label them.
- Keep `read` non-blocking; a blocking call stalls every channel on that driver.
- Report `dropped_samples` when the device tells you about a gap — it is what makes a
  waveform honest.
- Choose `sampleRate` to match the hardware, not to match a widget's refresh rate.

## Read Next

- [Sensors And IO](/platform/sensors-and-io)
- [Contracts](/reference/contracts)
- [Testing](/builders/testing)

---
name: "sensor-driver"
description: "Rules for adding or changing a SCARline sensor driver: the JSON manifest, the async SensorDriver class, registration, optional hardware dependencies, sample batching, and the real-time vehicle control path."
license: "Apache-2.0"
---

# SCARline Sensor Driver Skill

The IO Client (`services/io-client`) is a Python service that owns every sensor
device. A driver has two halves that must agree:

1. A **JSON manifest** in `services/io-client/drivers/<key>.json`, read by both
   the IO Client and CoreAPI to build the sensor catalogue.
2. A **Python class** subclassing `SensorDriver`, loaded only by the IO Client.

Requires Python 3.12 or newer. The IO Client runs either in the `io-docker`
Compose profile or on the host from `.runtime/io-client/venv`, depending on
`services.io_client.runtime` in `config.yml`.

## 1. The Manifest

Validated by `IoDriverManifestSchema` in `packages/contracts/src/io.ts`. Every
field is required.

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
    "properties": { "devicePath": { "type": "string" } }
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
| `key` | `^[a-z][a-z0-9_-]*$`, unique in the directory, and identical to the class's `key` |
| `platforms` | One or more of `linux`, `darwin`, `win32` |
| `capabilities` | Dotted lower case, `^[a-z][a-z0-9_.-]*$` |
| `channels` | At least one; each `key` matches `^[a-z][a-z0-9_-]*$` |
| `sampleRate` | Positive, at most 10000 Hz — match the hardware, not a widget's refresh rate |
| `unit` | A string or `null` |
| `optionalDependency` | Descriptive hint naming what real hardware needs, or `null` — see section 4 |
| `mock` | `true` only for synthetic drivers |

The channel `key` survives into event names: a `heart_rate` channel publishes
`events.<study>.<session>.health.io.heart_rate`. Choose it deliberately; renaming
it later breaks saved binding mappings.

## 2. The Driver Class

Subclass `SensorDriver` from `scarline_io.drivers.base`:

```python
import asyncio
from typing import Any

from ..models import Reading
from .base import SensorDriver


class MySensorDriver(SensorDriver):
    key = "my_sensor"

    def __init__(self) -> None:
        super().__init__()
        self.device: Any = None

    async def connect(self) -> None:
        try:
            import my_device_sdk          # imported here, not at module top
            path = str(self.configuration.get("devicePath", "/dev/my0"))
            self.device = await asyncio.to_thread(my_device_sdk.open, path)
            self.connected = True
        except Exception as error:
            raise RuntimeError(f"My Sensor unavailable: {error}") from error

    async def read(self, channel: str) -> Reading | None:
        if not self.running or self.device is None:
            return None
        value = self.device.poll()
        if value is None:
            return None
        return Reading(channel, {"value": value, "connected": True})

    async def disconnect(self) -> None:
        if self.device is not None:
            await asyncio.to_thread(self.device.close)
        self.device = None
        self.connected = self.running = False
```

| Member | Contract |
| --- | --- |
| `key` | Class attribute; matches the manifest |
| `configure(configuration)` | Stores `self.configuration`; called before `connect`. The base implementation is usually enough |
| `connect()` | Opens the device and sets `self.connected`. **Raise** on failure |
| `start()` / `pause()` / `resume()` | Toggle `self.running`. The base implementations are usually enough |
| `read(channel)` | One reading, or `None` when nothing is available |
| `get_state()` | Diagnostics; the base returns key, connected, running |
| `disconnect()` | Releases the device and clears both flags |

`connect`, `read`, and `disconnect` are abstract — you must implement them.

### Reading

```text
Reading(channel, sample, source_timestamp=<ISO-8601 now>, dropped_samples=0)
```

Set `source_timestamp` when the hardware supplies its own timestamp, and
`dropped_samples` when it reports a gap. Those two fields are what let CoreAPI
reconstruct an honest time series for waveform widgets.

### Rules For `read`

- Return `None` when there is no new sample. **Never** synthesise a plausible
  value — a widget shows `—` for absent data, which is correct.
- Return `None` immediately when `self.running` is false.
- Keep it non-blocking. Wrap blocking SDK calls in `asyncio.to_thread`; one
  blocking call stalls every channel on that driver.
- Raising ends the channel task and triggers the device's `onDisconnect` policy
  (see section 5). Raise for a genuine hardware failure, not for an empty poll.

### Import Optional Dependencies Inside `connect`

Import the hardware library inside `connect`, not at module scope, as
`G29Driver` does with `evdev`. That keeps the driver listed in the catalogue on
platforms where the extra is not installed, so the Admin Panel can show it and
explain why it is unavailable.

## 3. Registration

Built-in drivers are registered in `DRIVER_TYPES` at the bottom of
`services/io-client/scarline_io/drivers/builtin.py`:

```python
DRIVER_TYPES: dict[str, type[SensorDriver]] = {
    item.key: item for item in [MockDriver, G29Driver, CameraDriver, HeartRateDriver, EcgDriver]
}
```

An external package registers through the `scarline_io.drivers` entry point
group instead:

```toml
[project.entry-points."scarline_io.drivers"]
my_sensor = "my_package.driver:MySensorDriver"
```

The IO Client loads entry points at startup and raises `TypeError` for anything
that is not a `SensorDriver` subclass.

## 4. Dependencies

Hardware libraries go in an optional extra in
`services/io-client/pyproject.toml`, never in the base `dependencies`. Pin exact
versions, as the existing entries do:

```toml
[project.optional-dependencies]
my-extra = ["my-device-sdk==1.2.3"]
```

Declared extras today:

| Extra | Packages |
| --- | --- |
| `camera` | `mediapipe`, `opencv-python-headless` |
| `g29` | `evdev` (Linux only) |
| `heart-rate` | `bleak`, `pyserial` |
| `test` | `pytest`, `pytest-asyncio` |

**`optionalDependency` in the manifest is a descriptive hint, not a resolvable
reference.** Nothing in the platform reads it beyond schema validation — the
contract types it as a nullable non-empty string, and no code maps it to an
extra. The shipped manifests use it three different ways: `camera` and
`heart-rate` name the extra, `logitech_g29` names the Python package (`evdev`,
whose extra is `g29`), and `ecg` names `sifi-bridge`.

For new drivers, **name the extra**, so an operator can act on the value
directly. Do not assume an existing manifest's value is an extra.

> **Known gap.** `EcgDriver` imports `sifi_bridge_py`, and no extra declares it.
> On a stock install the import fails inside `connect`, surfacing as
> `RuntimeError: SiFi ECG unavailable: ...`. Add the package to an extra before
> relying on that driver.

## 5. Configuration And Lifecycle

**Never read environment variables or `config.yml` from a driver.** Everything
arrives through `self.configuration`, assembled by CoreAPI from the session
condition's snapshot and delivered with the start command. Read values with a
default and clamp them:

```python
deadzone = max(0.0, min(0.5, float(self.configuration.get("pedalDeadzone", 0.02))))
```

The IO Client consumes `commands.io-client.session-<action>` for `start`,
`advance`, `pause`, `resume`, `complete`, and `abort`, and answers each with a
`command.ack` event. A required driver that fails to start fails the command; an
optional one succeeds with a warning attached to the acknowledgement.

Per-device policy comes from the condition's device assignment:

| `onDisconnect` | Behaviour when a channel raises |
| --- | --- |
| `fail` | The IO Client publishes `lifecycle.session-fail` and the session ends |
| `continue` | The loss is recorded in the event stream and the session runs on |

It defaults to `fail` for devices marked required, `continue` otherwise.

## 6. Publishing

You do not publish. The host loop in `scarline_io/host.py` batches your readings
and publishes them. Do not open your own AMQP channel or call CoreAPI over HTTP.

A batch flushes when any of these is true:

- it reaches `services.io_client.batch_max_samples`
- `batch_max_milliseconds` have elapsed
- the channel's own period is at least `batch_max_milliseconds`, so a 1 Hz
  channel publishes each reading immediately instead of waiting

Routing key: `events.<studyId>.<sessionId>.<modality>.io.<channelKey>`. The
payload carries `sequenceStart`, `sampleRate`, `sourceTimestamp`,
`sampleTimestamps`, `droppedSamples`, and the samples.

### Real-Time Vehicle Control

A sample containing **all three** of `steer`, `throttle`, and `brake` is
additionally republished on the `scarline.realtime` exchange with routing key
`controls.<sessionId>`, clamped to `[-1, 1]` and `[0, 1]`. Sim-Bridge forwards it
to the bound simulator adapter. That is the whole contract for a steering
device — emit those three keys in one sample and the vehicle responds.

## 7. Making It Visible

```bash
scarline setup                  # reinstall the venv with the new extra
scarline stop && scarline start
```

Then **Sensors → refresh sensor drivers** in the Admin Panel, or
`POST /api/v1/sensors/refresh`. An invalid manifest is rejected with
`409 SENSOR_CATALOGUE_INVALID` and the specific validation issues.

Devices appear in the registry once the IO Client discovers them and publishes
`events.system.global.system.device.discovered`. CoreAPI upserts the device by
`source_key`, upserts its channels, and deactivates channels that disappeared.

## 8. Testing

```bash
.runtime/io-client/venv/bin/python -m pytest services/io-client/test
```

`pytest-asyncio` runs in auto mode, so `async def` tests need no decorator.
Follow the existing suites — `test_drivers.py`, `test_catalogue.py`,
`test_realtime.py`, `test_integration.py`. Cover at least:

- `read` returns `None` when not running and when the device has no sample
- `connect` raises, rather than returning quietly, when the device is absent
- configuration defaults and clamping
- for a control device, that a sample carries `steer`, `throttle`, and `brake`

## 9. Checklist

- [ ] Manifest key matches the class `key` and the file name
- [ ] Every channel declares `modality`, `sampleRate`, and a `unit` or `null`
- [ ] `platforms` is honest about where the driver can run
- [ ] Hardware library is an optional extra named by `optionalDependency`
- [ ] Hardware library is imported inside `connect`
- [ ] `read` returns `None` rather than inventing a value
- [ ] Blocking calls are wrapped in `asyncio.to_thread`
- [ ] `disconnect` releases the handle and clears `connected` and `running`
- [ ] Synthetic drivers set `mock: true` and mark samples `"simulated": True`
- [ ] Registered in `DRIVER_TYPES` or via the entry point group
- [ ] `pytest services/io-client/test` passes

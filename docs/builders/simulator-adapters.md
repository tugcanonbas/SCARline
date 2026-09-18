# Simulator Adapters

An adapter is a client that connects to Sim-Bridge, registers itself, and executes
session commands against a simulator. It holds no platform state, so it can restart
freely.

Reference implementations: `services/mock-simulator` (TypeScript) and
`services/carla-client` (Python).

## Connecting

Connect to `ws://<sim_bridge.host>:<sim_bridge.port><sim_bridge.adapter_path>` —
`ws://sim-bridge:9000/adapter` inside Compose. Authenticate with
`SIM_BRIDGE_ADAPTER_SECRET`.

Every frame is a JSON object validated against `SimulatorAdapterMessageSchema`, carrying
`version: 1`, a UUID `id`, and an ISO `timestamp`. Frames are capped at
`sim_bridge.maximum_websocket_message_bytes`.

## Registering

```json
{
  "version": 1,
  "id": "<uuid>",
  "timestamp": "2026-09-18T09:00:00.000Z",
  "type": "adapter.register",
  "adapterId": "my-simulator",
  "name": "My Simulator",
  "simulatorType": "mock",
  "simulatorVersion": "1.0.0",
  "capabilities": ["vehicle.telemetry", "vehicle-control"],
  "priority": 50,
  "activeSessionId": null
}
```

The bridge replies with `adapter.registered`, carrying the assigned id, the heartbeat
interval to use, and the maximum message size.

- `adapterId` must match `^[a-z][a-z0-9-]*$` and is the reconnection identity —
  reconnecting with the same id replaces the previous socket.
- `simulatorType` is `carla` or `mock`. It is what a condition's simulator configuration
  selects.
- `priority` is 0–10000; the lowest wins when several adapters of the same type are
  connected. CARLA uses 10, the Mock Simulator 100.
- `capabilities` are dotted lowercase strings. A simulator command may require one.
- `activeSessionId` is for reconnection. Claiming a session the bridge cannot recover
  from its journal is refused — so a stale adapter cannot re-attach to a session that
  has moved on.

## Heartbeats

Send `adapter.heartbeat` at the interval the bridge gave you, with status `ready`,
`busy`, or `degraded`, plus the active session.

Missing heartbeats for `sim_bridge.adapter_stale_timeout_seconds` marks the adapter
disconnected. The session binding is held for
`sim_bridge.adapter_reconnect_grace_seconds`; beyond that it is released and a session
failure is published.

## Commands

| Command | Do |
| --- | --- |
| `adapter.bind_session` | Load the condition's configuration and prepare the scenario |
| `adapter.advance_session` | Switch to the next condition's configuration |
| `adapter.pause_session` | Pause simulation and stop emitting telemetry |
| `adapter.resume_session` | Resume |
| `adapter.unbind_session` | Tear down; `reason` is `complete` or `abort` |
| `adapter.simulator_command` | Run a named command, honouring `requiredCapability` |
| `adapter.vehicle_control` | Apply throttle, steer, brake now — do not acknowledge |

Every command except `adapter.vehicle_control` must be answered with
`adapter.command_result`:

```json
{
  "version": 1,
  "id": "<uuid>",
  "timestamp": "2026-09-18T09:00:01.000Z",
  "type": "adapter.command_result",
  "commandId": "<the command's commandId>",
  "success": true,
  "code": "OK",
  "message": "",
  "details": {},
  "activeSessionId": "<uuid or null>"
}
```

`code` is `UPPER_SNAKE_CASE`. Answer before `deadlineAt`; a late answer has already
timed the session command out.

### Journal Your Results

Persist each `commandId` and its result. On restart, replay the stored result instead of
re-executing — that is what makes a mid-command restart safe. All three reference
adapters do this, and `sim_bridge.command_journal` has the same role on the bridge side.

## Events

| Message | When |
| --- | --- |
| `vehicle.telemetry` | Continuously while bound and running |
| `simulator.collision` | The ego vehicle collided |
| `simulator.lane_invasion` | Lane markings were crossed |
| `simulator.state` | `loading`, `ready`, `running`, `paused`, `stopped` |
| `simulator.gnss` | GNSS fix |
| `simulator.imu` | Accelerometer, gyroscope, compass |
| `simulator.sensor_artifact` | A `carla://` reference to a stored artifact |
| `adapter.error` | A problem; `fatal` decides whether the bridge tears down |

Sim-Bridge turns these into
`events.<studyId>.<sessionId>.<modality>.<eventType>` and enforces
`sim_bridge.telemetry_maximum_hz` — emitting faster is wasted work.

Telemetry fields: `speed` (non-negative), optional `speedLimit`, `throttle` and `brake`
in `[0, 1]`, `steer` in `[-1, 1]`.

## Real-Time Vehicle Control

`adapter.vehicle_control` arrives outside the command path, forwarded from the IO
Client's `controls.<sessionId>` messages. Apply it immediately and do not acknowledge.

Use a validity window — the CARLA adapter uses
`simulator.carla.control_timeout_milliseconds` — so that a dropped input stream falls
back to neutral instead of leaving the vehicle at its last throttle value.

## Adding A New Adapter

1. If it is a genuinely new simulator, add its value to `SimulatorTypeSchema` in
   `packages/contracts/src/simulator.ts`, and extend the configuration schema if the
   condition needs typed settings.
2. Implement register, heartbeat, the command set, and the events you can produce.
3. Add a command journal.
4. Add a Compose service under its own profile, and teach
   `packages/cli/src/commands/start.ts` how to select it.
5. Update `expectedComposeServices` in `packages/cli/src/infrastructure/compose.ts`.
6. Test against Sim-Bridge with `services/sim-bridge/test/socket.test.ts` as the model.

## Checklist

- [ ] Registers with a stable `adapterId` and a sensible `priority`
- [ ] Heartbeats within the interval the bridge assigned
- [ ] Answers every command before its deadline, including failures
- [ ] Journals command results and replays them after a restart
- [ ] Refuses to claim a session it cannot actually resume
- [ ] Respects the telemetry rate limit
- [ ] Applies real-time control with a timeout fallback
- [ ] Reports errors with `fatal` set honestly

## Read Next

- [Simulators](/platform/simulators)
- [Contracts](/reference/contracts)
- [Messaging](/reference/messaging)

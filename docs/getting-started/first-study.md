# Run Your First Study

Use this path when you need to go from an empty or freshly started stack to a study that is ready to run.

## 1. Bring The Platform Up

Run one launcher mode appropriate to the environment:

- `./scarline start` for the production-style stack
- `./scarline start --dev` for hot-reload local development
- `./scarline start --no-carla` when CARLA is unavailable and the rest of the stack should still boot

Then confirm:

- `/admin` loads
- `/docs` loads
- `/api/health` responds
- component health shows the expected runtime state

## 2. Complete Bootstrap And Sign In

The first-run flow is:

1. `Startup`
2. `Onboarding / System`
3. `Onboarding / Researcher`
4. `Login`
5. `Dashboard`

The system onboarding step persists the lab path, platform port, CARLA port, and overlay behavior. The researcher onboarding step creates the first sign-in identity with admin-level access.

## 3. Create Study Structure

Use `User Studies` to create the study shell, then configure:

- `Overview` for canonical study metadata
- `Conditions` for experimental variants, CARLA overrides, widget overrides, and trigger rules
- `Participants` for anonymized participant records and assigned conditions
- `CARLA Configuration` for simulator defaults
- `Sensor Configuration` for enabled drivers, sample rates, and required vs best-effort behavior
- `Participant View` for layout, display targeting, widget sizing, and window mode choices
- `Sessions` for participant-condition session records

## 4. Validate Readiness

Before a participant arrives, verify:

- database, RabbitMQ, CoreAPI, and overlay services are healthy
- the desired simulator path is available, or mock mode is intentionally in use
- the target condition is configured
- sensor drivers required by the protocol are online or explicitly marked degraded
- the participant layout contains the correct widgets and display targets

## 5. Run And Review

Use `Active Study Controls` to supervise the running session, inspect telemetry, and trigger manual widget actions. After the run:

- complete or cancel the session explicitly
- add notes when interruptions or anomalies occurred
- review `Session Logs`
- create artifacts from `Exports`

## Read Next

- [Study Lifecycle](/platform/study-lifecycle)
- [Study Readiness](/operations/study-readiness)
- [Active Session Operations](/operations/active-session-operations)
- [Exports And Evidence](/operations/exports-and-evidence)

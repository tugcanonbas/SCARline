# Study Readiness

Readiness is the last checkpoint between design-time configuration and participant-facing execution.

## Required Checks

- the target study exists and is in the intended status
- the participant and condition assignments are correct
- the session record has been created
- CARLA or mock configuration matches the run protocol
- required sensor drivers are connected
- participant layout widgets and displays match the planned setup
- component health is acceptable for the protocol

## Recommended UI Surfaces

- `Dashboard`
- `User Studies / Overview`
- `Conditions`
- `Participants`
- `CARLA Configuration`
- `Sensor Configuration`
- `Participant View`
- `Sessions`
- `Settings / Components`

## Readiness Notes To Capture

Record any important deviation before the run:

- simulator fallback to mock mode
- missing or degraded sensor
- display substitution
- last-minute condition override
- operator decision to continue under degraded circumstances

Those notes help later when interpreting logs and exports.

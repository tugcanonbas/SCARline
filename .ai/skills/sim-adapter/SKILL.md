---
name: "Simulator Protocol Adapter"
description: "Rules for implementing the WebSocket protocol linking a simulator (e.g., CARLA) to the SCARline Sim-Bridge."
license: "Apache-2.0"
---

# SCARline Simulator Adapter Skill

When writing an integration that connects a simulator engine to SCARline (like the CARLA Client or the Mock Simulator), you must act as a **Sim-Bridge Adapter**.

## 1. Connection Lifecycle

### Handshake
The adapter connects via WebSocket to the Sim-Bridge on `ws://scarline:9000/adapter`. Immediately upon connection, it must emit `adapter.register` with its capabilities array:

```json
{
  "type": "adapter.register",
  "name": "CARLA",
  "capabilities": ["map-loading", "weather-control", "vehicle-spawning"]
}
```

### Session Binding
The adapter sits idle until explicitly bound to a study run:
1. Sim-Bridge sends `adapter.bind_session` with full configurations (map, weather, vehicles, sensors).
2. The adapter loads the world, spawns entities, and applies config.
3. Sim-Bridge eventually sends `adapter.unbind_session` to destroy the simulation context.

## 2. Synchronous Simulation Rule

For high-fidelity research data collection (especially with CARLA), **you must enforce synchronous mode**.

- The simulation must block until the client signals ready to tick.
- The physics engine must be clamped to a **Fixed Delta Seconds of 0.05** (20 Hz).
- *Reasoning*: Uncapped frame rates lead to inconsistent sensor measurements, undermining the scientific validity of the study.

## 3. Telemetry Publishing

While a session is active, the adapter must continuously parse simulator physics info and push normalized telemetry exactly formatted for the Sim-Bridge ingestion:

```json
{
  "type": "vehicle.telemetry",
  "speed": 45.2,
  "throttle": 0.6,
  "steer": -0.01,
  "brake": 0.0
}
```

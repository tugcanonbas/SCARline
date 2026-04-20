# Extending Simulators And Sensors

Simulator and sensor integrations are plug-in style runtime participants, not owners of platform state.

## Simulator-Side Extensions

Work through Sim-Bridge:

- register adapters on the adapter WebSocket
- support heartbeat and command-response behavior
- publish simulator events back through the expected routing model
- keep bind, pause, resume, and unbind semantics aligned with CoreAPI session lifecycle

## Sensor-Side Extensions

Work through the I/O client:

- implement the driver interface
- expose useful health and capabilities metadata
- publish sensor status updates
- emit runtime readings on the correct routing keys
- distinguish degraded from fully disconnected behavior where possible

## Design Guidance

- keep adapters and drivers explicit about failure
- prefer recoverable degradation over silent no-op behavior
- preserve deterministic mock paths for testing whenever feasible

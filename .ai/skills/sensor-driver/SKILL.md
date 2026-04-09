---
name: "I/O Sensor Driver Developer"
description: "Guidelines and rules for writing Python integrations connecting physical hardware to SCARline."
license: "Apache-2.0"
---

# SCARline Sensor Driver Skill

The I/O Client acts as a host for Python modules linking physical hardware (Eye Trackers, Heart Rate Sensors, Steering Wheels, Body Tracking) into the SCARline event bus.

## 1. Class Implementation

When creating a new sensor integration, you must subclass the abstract `SensorDriver` interface:

```python
class MyCustomSensor(SensorDriver):
    async def connect(self):
        # Implementation to grasp hardware handle
        
    async def disconnect(self):
        # Cleanup routine
        
    async def configure(self, config_dict):
        # Apply parameters
        
    async def get_state(self):
        # Return health indicator
```

## 2. Configuration Management

- **Do not read Environment Variables**. You must expect the operator to configure the plugin via the `.scarline.yaml` file (if global) or via the study-specific JSON configuration sent during session start.
- Settings like `sampling_rate`, `device_port`, or `firmware_mode` belong in this dictionary.

## 3. Async Publishing via RabbitMQ

Data streams from sensors are often high-frequency (e.g., a 120Hz eye-tracker). Blocking I/O is unacceptable.

- You must use `aio-pika` to asynchronously publish reading events.
- Never use connection-intensive HTTP requests to stream data to the CoreAPI.
- Ensure messages exactly follow the structure defined in `RABBITMQ_EVENTS_AND_COMMANDS.md`, originating under `events.system.sensor.*` or `events.study.sensor.*`.

## 4. Packaging

Sensor drivers must be packaged as standard Python modules matching the `scarline_io_*` naming convention for dynamic discovery by the base I/O host.

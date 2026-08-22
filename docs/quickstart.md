# SCARline Quickstart Guide

This guide will help you set up and run the SCARline research platform from scratch. By the end of this guide, you will have the core infrastructure running inside Docker, the Python sensor acquisition layer running locally, and real-time data streaming into the combined monitoring dashboard.

---

## 1. Prerequisites

Ensure your development machine has the following dependencies installed:

*   **Docker Desktop** (with Docker Compose v2+)
*   **Python 3.12+**
*   **Node.js 20+** (or 24+)
*   **Git**
*   **Windows only:**
    *   **PowerShell 7+** (required to run launcher and automation scripts like `run_demos.ps1` and `scarline.ps1`)
*   **Linux only (optional for G29 physical hardware):**
    *   Required to read raw input events from the Logitech G29 steering wheel using the `evdev` driver library. On Windows/macOS, the steering wheel driver automatically falls back to **degraded mode** (publishing `steeringAngle: null`).

---

## 2. Clone & Boot the Infrastructure

### Clone the Repository

Clone the project repository and navigate into the root directory:

```bash
git clone <repo-url>
cd scarline
```

### Start the Local Stack

Run the startup launcher script with the `--no-carla` flag to start the development environment without launching a full CARLA simulator instance (which requires a dedicated GPU and host binary installation).

**Windows:**
```powershell
.\scarline.ps1 start --no-carla
```

**macOS / Linux:**
```bash
./scarline start --no-carla
```

### What this command does

The launcher orchestrates the entire application lifecycle by performing the following actions:
1.  Loads configuration settings from `.scarline.yaml` (falling back to `.scarline.yaml.example` if absent).
2.  Launches core persistent infrastructure services via **docker compose** (`postgres`, `rabbitmq`, and `schema-bootstrap`).
3.  Waits for database and broker health, then applies database schema migrations via the transient `schema-bootstrap` container.
4.  Launches application services: CoreAPI, Sim-Bridge, Admin Panel, Overlay Web runtime, I/O Client host container, and Nginx reverse proxy.
5.  Starts a local Python-based Process Manager IPC server on `127.0.0.1:4098` to manage background tasks.
6.  Starts a supervisor daemon to automatically restart crashed services.
7.  Automatically opens the Admin Panel dashboard in your default browser.

### Verification of Container Health

To check the status of the Docker services, run:

```bash
docker compose ps
```

All containers should report a `running (healthy)` status (except `schema-bootstrap` and `dev-seed` which should show `exited (0)` after successfully running migrations and seeding).

### RabbitMQ Management UI

The RabbitMQ broker is bundled with its management plugin. The Nginx reverse proxy routes traffic so you can access the interface directly:

*   **URL:** [http://localhost:8088/rabbitmq/](http://localhost:8088/rabbitmq/)
*   **Default Credentials:** Username `scarline` / Password `scarline`

---

## 3. Install Python Dependencies

The sensor drivers run on the host system to interact with local hardware (such as cameras, USB controllers, and Bluetooth radios).

Navigate to the I/O Client directory, set up a virtual environment, and install dependencies:

```bash
cd python/io-client
python -m venv .venv
```

Activate the virtual environment:

**Windows:**
```powershell
.venv\Scripts\activate
```

**macOS / Linux:**
```bash
source .venv/bin/activate
```

Install the dependencies:
```bash
pip install -r requirements.txt
```

> [!NOTE]
> The `requirements.txt` installs critical dependencies: `bleak` (Bluetooth Low Energy), `evdev` (Linux input event handler, skipped on Windows), `mediapipe` (computer vision tracking), and `opencv-python-headless` (image processing).

---

## 4. Run the Demo Sensors & Open Dashboards

To simulate hardware telemetry without physical sensors connected, SCARline provides standalone demo scripts. 

### Windows (Automated Launcher)

From the project root, run the PowerShell script to launch the demo servers and dashboards simultaneously:

```powershell
.\run_demos.ps1
```

This script performs the following actions:
1.  Sets the environment variable `AMQP_URL` to local RabbitMQ.
2.  Starts **MediaPipe Blink Detection** (`demo_camera_server.py`) which runs facial tracking and outputs EAR, MAR, head pose, and gaze.
3.  Starts **ECG Simulation** (`demo_ecg.py`) which generates simulated ECG waveform packets.
4.  Starts **Logitech G29 Simulation** (`demo_g29.py --dry-run`) which publishes periodic steering and pedal readings.
5.  Launches a lightweight local Web Server on port `8000` serving the telemetry dashboards.
6.  Automatically opens four browser tabs displaying live dashboards:
    *   Camera Feed / Blinks: `http://localhost:8000/camera.html`
    *   ECG Plotter: `http://localhost:8000/ecg.html`
    *   Steering / Pedals: `http://localhost:8000/g29.html`
    *   Combined HUD: `http://localhost:8000/combined.html`

To stop all demo processes cleanly, press `Ctrl + C` in the PowerShell window.

### macOS / Linux (Manual Launcher)

Run the equivalent scripts in the background or in separate terminal tabs with your virtual environment active:

```bash
# Start the demo telemetry publishers
python python/io-client/demo_camera_server.py &
python python/io-client/demo_ecg.py &
python python/io-client/demo_g29.py --dry-run &

# Start the dashboard web server
python -m http.server 8000 --directory tools/dashboards
```

Once running, manually navigate your browser to the combined dashboard at:
[http://localhost:8000/combined.html](http://localhost:8000/combined.html)

---

## 5. Verify Data Flow

Confirm that telemetry is flowing through the system by completing these three steps:

1.  **RabbitMQ Management UI:** Access [http://localhost:8088/rabbitmq/](http://localhost:8088/rabbitmq/), navigate to **Queues**, and verify that messages are actively being received on exchanges and routed to the queues.
2.  **Combined Dashboard:** Open the dashboard at [http://localhost:8000/combined.html](http://localhost:8000/combined.html). You should see:
    *   The `EAR` (Eye Aspect Ratio) bar moving.
    *   `Blinks` accumulating.
    *   The composite **Fatigue Index** changing dynamically based on facial markers.
    *   The sensor indicators in the status bar reporting `CONNECTED` (green).
3.  **Run the Test Suite:** Verify system integrity by running the workspace integration tests from the root directory:
    ```bash
    node --test tests/simulator/io-client.test.mjs \
                 tests/contracts/contracts.test.mjs \
                 tests/infra/topology.test.mjs \
                 tests/services/core-api.test.mjs \
                 tests/admin-panel/routes.test.mjs \
                 tests/simulator/mock-simulator.test.mjs
    ```
    **Expected Output:**
    `ℹ pass 78`, `ℹ fail 1`, `ℹ skipped 4`
    
    *Note: The single failing test is a stylesheet check (`apps/admin-panel/scripts/build-widgets-css.mjs --check`) which fails when `tailwindcss` is not globally available in your environment's PATH. This is expected and does not block the operation of the sensor layer.*

---

## 6. Hardware Sensors (Optional)

When moving from demo simulation to real hardware acquisition, edit your local `.scarline.yaml` file to configure the driver parameters. If a sensor is absent, the system gracefully defaults to **degraded mode**.

| Sensor Modality | Required Hardware | Degraded Mode Behavior (If Absent) |
| :--- | :--- | :--- |
| **Webcam (MediaPipe)** | Any standard USB webcam | `earAvg: null`, `blinkDetected: false`, `mar: null` |
| **Heart Rate (BLE)** | BLE-compliant heart rate monitor (Service `0x180D`) | `heartRateBpm: null` |
| **ECG** | SiFi Bridge Bluetooth device | `ecgSamples: null` |
| **Logitech G29** | Logitech G29 Wheel (Linux + `/dev/input/event*`) | `steeringAngle: null`, `throttle: null` (Always degraded on Windows) |

---

## 7. Next Steps

*   Review the [Sensor Integration Guide](sensor-integration-guide.md) to understand how to consume telemetry events and build custom web widgets.
*   Consult the [Architecture Decisions Record](architecture-decisions.md) to learn about the architectural trade-offs, synchronous driver interfaces, and custom RabbitMQ modalities used in SCARline.

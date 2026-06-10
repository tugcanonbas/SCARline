#!/usr/bin/env bash
# run_demos.sh — SCARline sensor demo launcher for Linux (CachyOS / Arch / Ubuntu)
#
# Usage:
#   ./run_demos.sh              # all sensors live
#   ./run_demos.sh --dry-run    # all sensors in stub/synthetic mode
#
# Prerequisites:
#   - Docker running with SCARline stack: ./scarline start --no-carla
#   - Python 3.12+ with: mediapipe, opencv-python, aio-pika, sifi-bridge-py, evdev
#   - Webcam connected, SiFi Bridge powered on, G29 connected via USB

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO_CLIENT_DIR="$SCRIPT_DIR/python/io-client"
DASHBOARD_DIR="$SCRIPT_DIR/tools/dashboards"
HTTP_PORT=8000

export AMQP_URL="${AMQP_URL:-amqp://scarline:scarline@localhost:5672/}"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN="--dry-run"
    echo "🔧 Running in DRY-RUN (stub) mode"
fi

echo "🚀 Starting SCARline Sensor Demos..."

# --- Start Camera ---
echo "📷 Starting MediaPipe Facial Telemetry..."
cd "$IO_CLIENT_DIR"
python demo_camera_server.py &
CAMERA_PID=$!
echo "   PID: $CAMERA_PID"

# --- Start ECG ---
echo "💓 Starting ECG (SiFi Bridge BLE)..."
cd "$IO_CLIENT_DIR"
python demo_ecg.py $DRY_RUN &
ECG_PID=$!
echo "   PID: $ECG_PID"

# --- Start G29 ---
echo "🎮 Starting Logitech G29 Telemetry..."
cd "$IO_CLIENT_DIR"
python demo_g29.py $DRY_RUN &
G29_PID=$!
echo "   PID: $G29_PID"

# --- Start HTTP Server ---
echo "🌐 Starting Dashboard HTTP Server on port $HTTP_PORT..."
cd "$DASHBOARD_DIR"
python -m http.server "$HTTP_PORT" --bind 0.0.0.0 &>/dev/null &
HTTP_PID=$!
echo "   PID: $HTTP_PID"

# Wait for HTTP server to be ready
sleep 2

# --- Open Dashboards ---
echo "🖥️  Opening Dashboards in browser..."
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$HTTP_PORT/camera.html" 2>/dev/null || true
    xdg-open "http://localhost:$HTTP_PORT/ecg.html" 2>/dev/null || true
    xdg-open "http://localhost:$HTTP_PORT/g29.html" 2>/dev/null || true
    xdg-open "http://localhost:$HTTP_PORT/combined.html" 2>/dev/null || true
elif command -v open &>/dev/null; then
    open "http://localhost:$HTTP_PORT/camera.html" 2>/dev/null || true
    open "http://localhost:$HTTP_PORT/ecg.html" 2>/dev/null || true
    open "http://localhost:$HTTP_PORT/g29.html" 2>/dev/null || true
    open "http://localhost:$HTTP_PORT/combined.html" 2>/dev/null || true
else
    echo "   (Could not auto-open browser. Navigate to http://localhost:$HTTP_PORT/combined.html manually)"
fi

echo ""
echo "✅ All demos running!"
echo "   Camera:    PID $CAMERA_PID"
echo "   ECG:       PID $ECG_PID"
echo "   G29:       PID $G29_PID"
echo "   HTTP:      PID $HTTP_PID (port $HTTP_PORT)"
echo ""
echo "   Dashboard: $DASHBOARD_URL"
echo ""
echo "Press Ctrl+C to stop all demos."

# Cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping all demos..."
    kill "$CAMERA_PID" "$ECG_PID" "$G29_PID" "$HTTP_PID" 2>/dev/null || true
    wait "$CAMERA_PID" "$ECG_PID" "$G29_PID" "$HTTP_PID" 2>/dev/null || true
    echo "✅ All demos stopped."
}
trap cleanup EXIT INT TERM

# Wait for any child to exit
wait

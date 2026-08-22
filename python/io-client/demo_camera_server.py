"""Standalone Blink Detection demo with HTTP MJPEG video feed server."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import cv2

# Ensure scarline_io package is importable
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from scarline_io.drivers.eye_tracker import BlinkDetectionDriver

STUDY_ID = "system"
RUN_ID = "global"
ROUTING_KEY = f"events.{STUDY_ID}.{RUN_ID}.sensor.io.blink"
EXCHANGE_NAME = "scarline.events"
HTTP_PORT = 8089

driver = BlinkDetectionDriver()

class MJPEGHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Suppress logs

    def do_GET(self):
        if self.path == '/video_feed':
            self.send_response(200)
            self.send_header('Content-type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                while True:
                    frame = getattr(driver, 'last_frame', None)
                    landmarks = getattr(driver, 'last_landmarks', None)
                    
                    if frame is not None:
                        draw_frame = frame.copy()
                        if landmarks:
                            h, w, _ = draw_frame.shape
                            # Only draw landmarks used for telemetry
                            active_indices = {
                                33, 160, 158, 133, 153, 144, # Right Eye
                                362, 385, 387, 263, 373, 380, # Left Eye
                                13, 14, 78, 308, # MAR
                                1, 152, # Head Pose
                                468, 469, 471, 473, 474, 476, # Gaze
                                107, 336 # Eyebrow
                            }
                            for i, lm in enumerate(landmarks):
                                if i in active_indices:
                                    cx, cy = int(lm.x * w), int(lm.y * h)
                                    cv2.circle(draw_frame, (cx, cy), 1, (0, 255, 0), -1)
                        
                        cv2.putText(draw_frame, "SCARline Live Feed", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                        
                        ret, jpeg = cv2.imencode('.jpg', draw_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                        if ret:
                            self.wfile.write(b'--frame\r\n')
                            self.send_header('Content-type', 'image/jpeg')
                            self.send_header('Content-length', str(len(jpeg)))
                            self.end_headers()
                            self.wfile.write(jpeg.tobytes())
                            self.wfile.write(b'\r\n')
                    time.sleep(0.05) # 20fps
            except Exception:
                pass
        else:
            self.send_response(404)
            self.end_headers()

def run_http_server():
    server = HTTPServer(('0.0.0.0', HTTP_PORT), MJPEGHandler)
    print(f"[DEMO CAMERA] HTTP MJPEG server running on http://localhost:{HTTP_PORT}/video_feed")
    server.serve_forever()

def build_payload(*, blink_detected: bool, ear_avg: float, blink_count: int, eyes_closed: bool, connected: bool,
                  mar: float | None = None, yawn_detected: bool | None = None, 
                  head_pose: dict | None = None, gaze_point: dict | None = None, 
                  eyebrow_distance: float | None = None) -> dict:
    return {
        "studyId": STUDY_ID,
        "runId": RUN_ID,
        "blinkDetected": blink_detected,
        "earAvg": ear_avg,
        "blinkCount": blink_count,
        "eyesClosed": eyes_closed,
        "connected": connected,
        "mar": mar,
        "yawnDetected": yawn_detected,
        "headPose": head_pose,
        "gazePoint": gaze_point,
        "eyebrowDistance": eyebrow_distance,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    }

def build_envelope(payload: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "timestamp": payload["timestamp"],
        "routingKey": ROUTING_KEY,
        "producer": "io-client-demo",
        "type": "event",
        "payload": payload,
        "metadata": {
            "studyId": None,
            "runId": None,
            "correlationId": None,
        },
    }

async def run_live() -> None:
    import aio_pika

    amqp_url = os.environ.get("AMQP_URL", "amqp://scarline:scarline@localhost:5672/")

    ok = driver.initialize({
        "camera_index": 0, 
        "sample_rate": 20,
        "consec_frames": 1,
        "ear_threshold": 0.25
    })
    if not ok:
        print("[DEMO CAMERA] ERROR: Failed to initialize camera driver.", file=sys.stderr)
        sys.exit(1)
        
    threading.Thread(target=run_http_server, daemon=True).start()
    
    driver.start()
    print(f"[DEMO CAMERA] RabbitMQ publishing started to {amqp_url}")

    try:
        connection = await aio_pika.connect_robust(amqp_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(EXCHANGE_NAME, aio_pika.ExchangeType.TOPIC, durable=True)

        while True:
            reading = driver.read()
            if reading is not None:
                data = reading.data
                payload = build_payload(
                    blink_detected=data.get("blink_detected", False),
                    ear_avg=data.get("ear_avg", 0.0) or 0.0,
                    blink_count=data.get("blink_count", 0),
                    eyes_closed=data.get("eyes_closed", False),
                    connected=data.get("connected", True),
                    mar=data.get("mar"),
                    yawn_detected=data.get("yawnDetected"),
                    head_pose=data.get("headPose"),
                    gaze_point=data.get("gazePoint"),
                    eyebrow_distance=data.get("eyebrowDistance"),
                )
                envelope = build_envelope(payload)
                await exchange.publish(
                    aio_pika.Message(
                        body=json.dumps(envelope).encode("utf8"),
                        content_type="application/json",
                        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                        message_id=envelope["id"],
                    ),
                    routing_key=ROUTING_KEY,
                )
            await asyncio.sleep(0.05)
    except KeyboardInterrupt:
        pass
    finally:
        driver.stop()
        driver.shutdown()
        try:
            await connection.close()
        except Exception:
            pass

async def main() -> None:
    await run_live()

if __name__ == "__main__":
    asyncio.run(main())

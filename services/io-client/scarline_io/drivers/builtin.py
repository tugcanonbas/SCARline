from __future__ import annotations

import asyncio
import math
import random
import time
from pathlib import Path
from typing import Any

from ..models import Reading
from .base import SensorDriver


RIGHT_EYE = (33, 160, 158, 133, 153, 144)
LEFT_EYE = (362, 385, 387, 263, 373, 380)


def landmark_distance(points: Any, left: int, right: int) -> float:
    return math.hypot(points[left].x - points[right].x, points[left].y - points[right].y)


def eye_aspect_ratio(points: Any, indices: tuple[int, ...]) -> float:
    p1, p2, p3, p4, p5, p6 = indices
    return (landmark_distance(points, p2, p6) + landmark_distance(points, p3, p5)) / (2 * max(landmark_distance(points, p1, p4), 1e-9))


def normalized_gaze(points: Any) -> tuple[float | None, float | None]:
    values: list[tuple[float, float]] = []
    for iris, inner, outer, top, bottom in ((468,133,33,159,145),(473,362,263,386,374)):
        horizontal = abs(points[outer].x - points[inner].x); vertical = abs(points[bottom].y - points[top].y)
        if horizontal < 1e-9 or vertical < 1e-9: return None, None
        x = (points[iris].x - min(points[inner].x, points[outer].x)) / horizontal
        y = (points[iris].y - min(points[top].y, points[bottom].y)) / vertical
        values.append((max(0.0, min(1.0, x)), max(0.0, min(1.0, y))))
    return round(sum(item[0] for item in values) / 2, 4), round(sum(item[1] for item in values) / 2, 4)


class MockDriver(SensorDriver):
    key = "mock"
    async def connect(self) -> None: self.connected = True
    async def disconnect(self) -> None: self.connected = self.running = False
    async def read(self, channel: str) -> Reading | None:
        if not self.running: return None
        t = time.monotonic()
        if channel == "steering":
            return Reading(channel, {"steer": round(math.sin(t) * .35, 4), "throttle": .4, "brake": 0.0, "clutch": 0.0, "gear": 3, "buttons": {}, "connected": True})
        if channel == "heart_rate": return Reading(channel, {"heartRateBpm": 72 + round(math.sin(t / 4) * 4, 2), "rrIntervalMs": 833.0, "connected": True})
        if channel == "ecg": return Reading(channel, {"value": round(math.sin(t * 2 * math.pi * 1.2) + random.uniform(-.02, .02), 5), "connected": True})
        return Reading(channel, {"gaze": {"x": .5 + math.sin(t) * .1, "y": .5}, "pupilDiameter": .03, "blinkDetected": False, "connected": True})


class G29Driver(SensorDriver):
    key = "logitech_g29"
    def __init__(self) -> None:
        super().__init__(); self.device: Any = None
        self.state: dict[str, Any] = {"steer": 0.0, "throttle": 0.0, "brake": 0.0, "clutch": 0.0, "gear": 1, "buttons": {}}
    def _axis_range(self, code: int, fallback_maximum: float) -> tuple[float, float]:
        try:
            info = self.device.absinfo(code)
            return float(info.min), float(info.max)
        except Exception: return 0.0, fallback_maximum
    def _steering(self, value: float, minimum: float, maximum: float) -> float:
        if maximum <= minimum: return 0.0
        result = max(-1.0, min(1.0, ((value - minimum) / (maximum - minimum)) * 2 - 1))
        deadzone = max(0.0, min(.5, float(self.configuration.get("steeringDeadzone", .02))))
        if abs(result) <= deadzone: return 0.0
        return round(math.copysign((abs(result) - deadzone) / (1 - deadzone), result), 4)
    def _pedal(self, value: float, minimum: float, maximum: float) -> float:
        if maximum <= minimum: return 0.0
        result = max(0.0, min(1.0, (value - minimum) / (maximum - minimum)))
        if self.configuration.get("invertPedals", True): result = 1 - result
        deadzone = max(0.0, min(.5, float(self.configuration.get("pedalDeadzone", .02))))
        if result <= deadzone: return 0.0
        return round((result - deadzone) / (1 - deadzone), 4)
    async def connect(self) -> None:
        try:
            import evdev
            configured = self.configuration.get("devicePath")
            if configured:
                path = str(configured)
            else:
                candidates = [item for item in evdev.list_devices() if "G29" in evdev.InputDevice(item).name]
                path = candidates[0] if candidates else "/dev/input/by-id/usb-Logitech_G29_Driving_Force_Racing_Wheel-event-joystick"
            self.device = await asyncio.to_thread(evdev.InputDevice, path)
            await asyncio.to_thread(self.device.grab); self.connected = True
        except Exception as error: raise RuntimeError(f"Logitech G29 unavailable: {error}") from error
    async def read(self, channel: str) -> Reading | None:
        if not self.running or self.device is None: return None
        try:
            import evdev
            for event in self.device.read():
                if event.type == evdev.ecodes.EV_ABS:
                    if event.code == evdev.ecodes.ABS_X:
                        minimum, maximum = self._axis_range(event.code, 65_535); self.state["steer"] = self._steering(event.value, minimum, maximum)
                    elif event.code == evdev.ecodes.ABS_Z:
                        minimum, maximum = self._axis_range(event.code, 255); self.state["brake"] = self._pedal(event.value, minimum, maximum)
                    elif event.code == evdev.ecodes.ABS_RZ:
                        minimum, maximum = self._axis_range(event.code, 255); self.state["throttle"] = self._pedal(event.value, minimum, maximum)
                elif event.type == evdev.ecodes.EV_KEY: self.state["buttons"][str(event.code)] = bool(event.value)
        except BlockingIOError: pass
        return Reading(channel, {**self.state, "connected": True})
    async def disconnect(self) -> None:
        if self.device is not None:
            try: await asyncio.to_thread(self.device.ungrab); await asyncio.to_thread(self.device.close)
            except Exception: pass
        self.device = None; self.connected = self.running = False


class HeartRateDriver(SensorDriver):
    key = "heart_rate"
    def __init__(self) -> None:
        super().__init__(); self.client: Any = None; self.serial: Any = None; self.bpm: float | None = None; self.rr: float | None = None
    async def connect(self) -> None:
        backend = self.configuration.get("backend", "ble")
        if backend == "serial":
            try:
                import serial
                self.serial = await asyncio.to_thread(serial.Serial, self.configuration.get("serialPort", "COM3"), int(self.configuration.get("serialBaud", 9600)), timeout=1)
                self.connected = True; return
            except Exception as error: raise RuntimeError(f"Serial heart-rate monitor unavailable: {error}") from error
        try:
            from bleak import BleakClient, BleakScanner
            address = self.configuration.get("deviceAddress")
            device = await BleakScanner.find_device_by_address(address) if address else await BleakScanner.find_device_by_filter(lambda d, a: "0000180d-0000-1000-8000-00805f9b34fb" in (a.service_uuids or []))
            if device is None: raise RuntimeError("No Bluetooth Heart Rate Service found")
            self.client = BleakClient(device); await self.client.connect(); self.connected = True
        except Exception as error: raise RuntimeError(f"BLE heart-rate monitor unavailable: {error}") from error
    async def read(self, channel: str) -> Reading | None:
        if not self.running: return None
        if self.serial is not None:
            line = (await asyncio.to_thread(self.serial.readline)).decode("ascii", "ignore").strip()
            if line.startswith("BPM:"):
                try: self.bpm = float(line.split(":", 1)[1])
                except ValueError: pass
        elif self.client is not None:
            data = await self.client.read_gatt_char("00002a37-0000-1000-8000-00805f9b34fb")
            if data:
                wide = bool(data[0] & 1); offset = 3 if wide else 2
                self.bpm = float(int.from_bytes(data[1:3], "little")) if wide else float(data[1])
                if data[0] & 0x10 and len(data) >= offset + 2:
                    self.rr = round(int.from_bytes(data[offset:offset+2], "little") / 1024 * 1000, 3)
        return Reading(channel, {"heartRateBpm": self.bpm, "rrIntervalMs": self.rr, "connected": self.connected})
    async def disconnect(self) -> None:
        if self.client is not None: await self.client.disconnect()
        if self.serial is not None: await asyncio.to_thread(self.serial.close)
        self.client = self.serial = None; self.connected = self.running = False


class EcgDriver(SensorDriver):
    key = "ecg"
    def __init__(self) -> None: super().__init__(); self.bridge: Any = None
    async def connect(self) -> None:
        try:
            import sifi_bridge_py as sbp
            self.bridge = sbp.SifiBridge(); mac = self.configuration.get("mac")
            connected = await asyncio.to_thread(self.bridge.connect, mac) if mac else await asyncio.to_thread(self.bridge.connect)
            if not connected: raise RuntimeError("device rejected connection")
            rate = int(self.configuration.get("sampleRate", 500))
            await asyncio.to_thread(self.bridge.set_channels, ecg=True)
            await asyncio.to_thread(self.bridge.configure_sampling_freqs, ecg=rate)
            await asyncio.to_thread(self.bridge.configure_ecg, bandpass_freqs=(int(self.configuration.get("flo", 0)), int(self.configuration.get("fhi", 30))))
            await asyncio.to_thread(self.bridge.start); self.connected = True
        except Exception as error: raise RuntimeError(f"SiFi ECG unavailable: {error}") from error
    async def read(self, channel: str) -> Reading | None:
        if not self.running or self.bridge is None: return None
        packet = await asyncio.to_thread(self.bridge.get_ecg)
        if not packet: return None
        return Reading(channel, {"ecgSamples": packet.get("data", {}).get("ecg", []), "sampleRate": packet.get("sample_rate", self.configuration.get("sampleRate", 500)), "dataLostCount": packet.get("data_lost_count", {}).get("ecg", 0), "connected": True})
    async def disconnect(self) -> None:
        if self.bridge is not None:
            try: await asyncio.to_thread(self.bridge.stop); await asyncio.to_thread(self.bridge.disconnect)
            except Exception: pass
        self.bridge = None; self.connected = self.running = False


class CameraDriver(SensorDriver):
    key = "camera"
    def __init__(self) -> None:
        super().__init__(); self.capture: Any = None; self.face_mesh: Any = None; self.writer: Any = None; self.last: dict[str, Any] = {}; self.lock = asyncio.Lock(); self.blink_count = 0; self.closed_frames = 0
    async def connect(self) -> None:
        try:
            import cv2
            self.capture = await asyncio.to_thread(cv2.VideoCapture, int(self.configuration.get("cameraIndex", 0)))
            if not self.capture.isOpened(): raise RuntimeError("camera could not be opened")
            recording_path = self.configuration.get("recordingPath")
            if recording_path:
                target = Path(str(recording_path)); target.parent.mkdir(parents=True, exist_ok=True)
                width = int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH)); height = int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
                rate = float(self.configuration.get("sampleRate", 30))
                self.writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), rate, (width, height))
                if not self.writer.isOpened(): raise RuntimeError(f"recording file could not be opened: {target}")
            try:
                import mediapipe as mp
                self.face_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
            except Exception: self.face_mesh = None
            self.connected = True
        except Exception as error: raise RuntimeError(f"Camera unavailable: {error}") from error
    async def read(self, channel: str) -> Reading | None:
        async with self.lock:
            return await self._read_locked(channel)
    async def _read_locked(self, channel: str) -> Reading | None:
        if not self.running or self.capture is None: return None
        ok, frame = await asyncio.to_thread(self.capture.read)
        if not ok: return None
        if channel == "camera" and self.writer is not None: await asyncio.to_thread(self.writer.write, frame)
        if channel == "camera": return Reading(channel, {"frameWidth": int(frame.shape[1]), "frameHeight": int(frame.shape[0]), "recording": self.writer is not None, "connected": True})
        if self.face_mesh is None: return Reading(channel, self._unavailable_features(True))
        import cv2
        result = await asyncio.to_thread(self.face_mesh.process, cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if not result.multi_face_landmarks: return Reading(channel, self._unavailable_features(True))
        points = result.multi_face_landmarks[0].landmark
        ear_left = eye_aspect_ratio(points, LEFT_EYE); ear_right = eye_aspect_ratio(points, RIGHT_EYE); ear = (ear_left + ear_right) / 2
        eyes_closed = ear < float(self.configuration.get("earThreshold", .21)); blink_detected = False
        if channel == "blink":
            if eyes_closed: self.closed_frames += 1
            else:
                if self.closed_frames >= int(self.configuration.get("consecFrames", 2)): self.blink_count += 1; blink_detected = True
                self.closed_frames = 0
        gaze_x, gaze_y = normalized_gaze(points)
        mar = landmark_distance(points, 13, 14) / max(landmark_distance(points, 78, 308), 1e-9)
        width, height = frame.shape[1], frame.shape[0]
        roll = math.degrees(math.atan2((points[263].y-points[33].y)*height, (points[263].x-points[33].x)*width))
        head_pose = {"pitch":round(points[1].y-points[152].y,4), "yaw":round(points[1].x-(points[33].x+points[263].x)/2,4), "roll":round(roll,4)}
        pupil = (landmark_distance(points,469,471)+landmark_distance(points,474,476))/2
        return Reading(channel, {"earLeft":round(ear_left,4), "earRight":round(ear_right,4), "earAverage":round(ear,4), "blinkDetected":blink_detected, "blinkCount":self.blink_count, "eyesClosed":eyes_closed, "mouthAspectRatio":round(mar,4), "yawnDetected":mar > float(self.configuration.get("yawnThreshold", .6)), "headPose":head_pose, "gazePoint":{"x":gaze_x,"y":gaze_y}, "eyebrowDistance":round(landmark_distance(points,107,336),4), "gaze":{"x":gaze_x,"y":gaze_y}, "pupilDiameter":round(pupil,6), "connected":True, "faceDetected":True})
    def _unavailable_features(self, connected: bool) -> dict[str, Any]:
        return {"earLeft":None,"earRight":None,"earAverage":None,"blinkDetected":False,"blinkCount":self.blink_count,"eyesClosed":False,"mouthAspectRatio":None,"yawnDetected":False,"headPose":None,"gazePoint":{"x":None,"y":None},"eyebrowDistance":None,"gaze":{"x":None,"y":None},"pupilDiameter":None,"connected":connected,"faceDetected":False}
    async def disconnect(self) -> None:
        if self.writer is not None: await asyncio.to_thread(self.writer.release)
        if self.capture is not None: await asyncio.to_thread(self.capture.release)
        if self.face_mesh is not None: await asyncio.to_thread(self.face_mesh.close)
        self.capture = self.face_mesh = self.writer = None; self.connected = self.running = False


DRIVER_TYPES: dict[str, type[SensorDriver]] = {item.key: item for item in [MockDriver, G29Driver, CameraDriver, HeartRateDriver, EcgDriver]}

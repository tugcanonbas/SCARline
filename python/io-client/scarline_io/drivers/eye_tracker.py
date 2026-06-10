from __future__ import annotations

import math
import time
from typing import Any

from .base import SensorDriver, SensorMetadata, SensorReading

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None

try:
    import mediapipe as mp  # type: ignore
except Exception:  # pragma: no cover
    mp = None

# MediaPipe FaceMesh landmark indices for EAR computation
# Right eye (from subject's perspective): p1=33, p2=160, p3=158, p4=133, p5=153, p6=144
_RIGHT_EYE = (33, 160, 158, 133, 153, 144)
# Left eye (from subject's perspective): p1=362, p2=385, p3=387, p4=263, p5=373, p6=380
_LEFT_EYE = (362, 385, 387, 263, 373, 380)

# MediaPipe FaceMesh iris landmark indices (requires refine_landmarks=True)
# Right iris: center=468, extremes=469,470,471,472
_RIGHT_IRIS_CENTER = 468
_RIGHT_IRIS_EXTREMES = (469, 471)  # horizontal diameter endpoints
# Left iris: center=473, extremes=474,475,476,477
_LEFT_IRIS_CENTER = 473
_LEFT_IRIS_EXTREMES = (474, 476)  # horizontal diameter endpoints

# Right eye bounding box corners for gaze normalization
_RIGHT_EYE_INNER = 133
_RIGHT_EYE_OUTER = 33
_RIGHT_EYE_TOP = 159
_RIGHT_EYE_BOTTOM = 145
# Left eye bounding box corners for gaze normalization
_LEFT_EYE_INNER = 362
_LEFT_EYE_OUTER = 263
_LEFT_EYE_TOP = 386
_LEFT_EYE_BOTTOM = 374


def _landmark_dist(a: Any, b: Any) -> float:
    """Euclidean distance between two MediaPipe NormalizedLandmark points."""
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def _eye_aspect_ratio(landmarks: Any, indices: tuple[int, ...]) -> float:
    """Compute Eye Aspect Ratio (EAR) for one eye.

    EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)

    Returns 0.0 if the horizontal distance is zero to avoid division errors.
    """
    p1, p2, p3, p4, p5, p6 = (landmarks[i] for i in indices)
    vertical_a = _landmark_dist(p2, p6)
    vertical_b = _landmark_dist(p3, p5)
    horizontal = _landmark_dist(p1, p4)
    if horizontal < 1e-6:
        return 0.0
    return (vertical_a + vertical_b) / (2.0 * horizontal)


def _compute_gaze(landmarks: Any) -> tuple[float | None, float | None]:
    """Estimate normalized gaze direction from iris position within eye bounding box.

    Returns (x, y) where x=0 means looking fully left, x=1 means fully right,
    y=0 means looking fully up, y=1 means looking fully down.
    Returns (0.5, 0.5) when looking straight ahead.
    Returns (None, None) if computation fails.
    """
    try:
        gaze_values = []
        for iris_center, eye_inner, eye_outer, eye_top, eye_bottom in [
            (_RIGHT_IRIS_CENTER, _RIGHT_EYE_INNER, _RIGHT_EYE_OUTER, _RIGHT_EYE_TOP, _RIGHT_EYE_BOTTOM),
            (_LEFT_IRIS_CENTER, _LEFT_EYE_INNER, _LEFT_EYE_OUTER, _LEFT_EYE_TOP, _LEFT_EYE_BOTTOM),
        ]:
            ic = landmarks[iris_center]
            ei = landmarks[eye_inner]
            eo = landmarks[eye_outer]
            et = landmarks[eye_top]
            eb = landmarks[eye_bottom]
            h_range = abs(eo.x - ei.x)
            v_range = abs(eb.y - et.y)
            if h_range < 1e-6 or v_range < 1e-6:
                return (None, None)
            gx = (ic.x - min(ei.x, eo.x)) / h_range
            gy = (ic.y - min(et.y, eb.y)) / v_range
            gaze_values.append((max(0.0, min(1.0, gx)), max(0.0, min(1.0, gy))))
        # Average both eyes
        x = (gaze_values[0][0] + gaze_values[1][0]) / 2.0
        y = (gaze_values[0][1] + gaze_values[1][1]) / 2.0
        return (round(x, 4), round(y, 4))
    except Exception:
        return (None, None)


def _compute_pupil_diameter(landmarks: Any) -> float | None:
    """Estimate pupil diameter as average iris horizontal diameter (normalized coords).

    Uses the horizontal extremes of each iris to compute diameter,
    then averages both eyes.
    Returns None if computation fails.
    """
    try:
        diameters = []
        for extremes in [_RIGHT_IRIS_EXTREMES, _LEFT_IRIS_EXTREMES]:
            p_left = landmarks[extremes[0]]
            p_right = landmarks[extremes[1]]
            d = _landmark_dist(p_left, p_right)
            diameters.append(d)
        avg = sum(diameters) / len(diameters)
        return round(avg, 6)
    except Exception:
        return None


class BlinkDetectionDriver(SensorDriver):
    """Webcam-based blink detection using MediaPipe FaceMesh and EAR ratio.

    Publishes to topic: events.{studyId}.{runId}.sensor.io.blink

    Runs in degraded mode (stub data, no exceptions) when cv2 or mediapipe
    are unavailable or the webcam cannot be opened.
    """

    def __init__(self) -> None:
        self.sample_rate = 10
        self.active = False
        self.connected = False
        self.camera_index = 0
        self.ear_threshold = 0.21
        self.consec_frames = 2
        self._capture: Any = None
        self._face_mesh: Any = None
        self._blink_counter = 0
        self._frame_counter = 0
        self.last_frame: Any = None
        self.last_landmarks: Any = None

    def _compute_mar(self, landmarks: Any) -> float:
        try:
            p_top = landmarks[13]
            p_bottom = landmarks[14]
            p_left = landmarks[78]
            p_right = landmarks[308]
            v_dist = _landmark_dist(p_top, p_bottom)
            h_dist = _landmark_dist(p_left, p_right)
            if h_dist < 1e-6:
                return 0.0
            return round(v_dist / h_dist, 4)
        except Exception:
            return 0.0

    def _compute_head_pose(self, landmarks: Any, w: int, h: int) -> dict[str, float]:
        try:
            nose = landmarks[1]
            chin = landmarks[152]
            left_eye = landmarks[33]
            right_eye = landmarks[263]
            
            n_y = nose.y * h
            c_y = chin.y * h
            n_x = nose.x * w
            le_x = left_eye.x * w
            re_x = right_eye.x * w
            le_y = left_eye.y * h
            re_y = right_eye.y * h
            
            pitch = (n_y - c_y) / h
            yaw = (n_x - (le_x + re_x) / 2.0) / w
            roll = math.degrees(math.atan2(re_y - le_y, re_x - le_x))
            
            return {
                "pitch": round(pitch, 4),
                "yaw": round(yaw, 4),
                "roll": round(roll, 4)
            }
        except Exception:
            return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0}

    def _compute_gaze(self, landmarks: Any) -> dict[str, float]:
        gx, gy = _compute_gaze(landmarks)
        return {"x": gx if gx is not None else 0.5, "y": gy if gy is not None else 0.5}

    def _compute_eyebrow_distance(self, landmarks: Any, h: int) -> float:
        try:
            p_left = landmarks[107]
            p_right = landmarks[336]
            return round(_landmark_dist(p_left, p_right), 4)
        except Exception:
            return 0.0

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="blink",
            sensor_type="blink",
            display_name="MediaPipe Blink Detection",
            version="1.0.0",
            sample_rate=self.sample_rate,
            custom_fields={
                "driverClass": "mediapipe-facemesh",
                "capabilities": ["blink", "ear_ratio"],
                "ear_threshold": self.ear_threshold,
                "consec_frames": self.consec_frames,
            },
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(
            config.get("sample_rate", config.get("sampleRate", 10))
        )
        self.camera_index = int(
            config.get("camera_index", config.get("cameraIndex", 0))
        )
        self.ear_threshold = float(
            config.get("ear_threshold", config.get("earThreshold", 0.21))
        )
        self.consec_frames = int(
            config.get("consec_frames", config.get("consecFrames", 2))
        )

        if cv2 is None or mp is None:
            self.connected = False
            return False

        try:
            self._capture = cv2.VideoCapture(self.camera_index)
            if not (self._capture and self._capture.isOpened()):
                self._capture = None
                self.connected = False
                return False
        except Exception:
            self._capture = None
            self.connected = False
            return False

        try:
            self._face_mesh = mp.solutions.face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception:
            if self._capture is not None:
                self._capture.release()
                self._capture = None
            self.connected = False
            return False

        self.connected = True
        self._blink_counter = 0
        self._frame_counter = 0
        return True

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        # Degraded mode: no webcam or no libraries
        if not self.connected or self._capture is None or self._face_mesh is None:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "ear_left": None,
                    "ear_right": None,
                    "ear_avg": None,
                    "blink_detected": False,
                    "blink_count": self._blink_counter,
                    "eyes_closed": False,
                    "connected": False,
                    "mar": None,
                    "yawnDetected": None,
                    "headPose": None,
                    "gazePoint": None,
                    "eyebrowDistance": None,
                },
                metadata={"source": "baseline-unavailable"},
            )

        try:
            ok, frame = self._capture.read()
        except Exception:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "ear_left": None,
                    "ear_right": None,
                    "ear_avg": None,
                    "blink_detected": False,
                    "blink_count": self._blink_counter,
                    "eyes_closed": False,
                    "connected": False,
                    "mar": None,
                    "yawnDetected": None,
                    "headPose": None,
                    "gazePoint": None,
                    "eyebrowDistance": None,
                },
                metadata={"source": "baseline-unavailable"},
            )

        if not ok or frame is None:
            return None

        self.last_frame = frame.copy()

        # Convert BGR → RGB for MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._face_mesh.process(rgb)

        if not results or not results.multi_face_landmarks:
            self.last_landmarks = None
            return SensorReading(
                timestamp=time.time(),
                data={
                    "ear_left": None,
                    "ear_right": None,
                    "ear_avg": None,
                    "blink_detected": False,
                    "blink_count": self._blink_counter,
                    "eyes_closed": False,
                    "connected": True,
                    "mar": None,
                    "yawnDetected": None,
                    "headPose": None,
                    "gazePoint": None,
                    "eyebrowDistance": None,
                },
                metadata={"source": "mediapipe-facemesh", "face_detected": False},
            )

        landmarks = results.multi_face_landmarks[0].landmark
        self.last_landmarks = landmarks
        ear_left = _eye_aspect_ratio(landmarks, _LEFT_EYE)
        ear_right = _eye_aspect_ratio(landmarks, _RIGHT_EYE)
        ear_avg = (ear_left + ear_right) / 2.0
        eyes_closed = ear_avg < self.ear_threshold

        blink_detected = False
        if eyes_closed:
            self._frame_counter += 1
        else:
            if self._frame_counter >= self.consec_frames:
                self._blink_counter += 1
                blink_detected = True
            self._frame_counter = 0

        h, w, _ = frame.shape
        mar = self._compute_mar(landmarks)
        yawn_detected = mar > 0.6
        head_pose = self._compute_head_pose(landmarks, w, h)
        gaze_point = self._compute_gaze(landmarks)
        eyebrow_dist = self._compute_eyebrow_distance(landmarks, h)

        return SensorReading(
            timestamp=time.time(),
            data={
                "ear_left": round(ear_left, 4),
                "ear_right": round(ear_right, 4),
                "ear_avg": round(ear_avg, 4),
                "blink_detected": blink_detected,
                "blink_count": self._blink_counter,
                "eyes_closed": eyes_closed,
                "connected": True,
                "mar": mar,
                "yawnDetected": yawn_detected,
                "headPose": head_pose,
                "gazePoint": gaze_point,
                "eyebrowDistance": eyebrow_dist,
            },
            metadata={"source": "mediapipe-facemesh", "face_detected": True},
        )

    def calibrate(self) -> bool:
        """Attempt calibration by checking 30 frames for face/eye detection.

        Returns True if average EAR over sampled frames exceeds 0.15,
        indicating eyes are reliably detected.
        Returns False in degraded mode or if eyes cannot be detected.
        """
        if not self.connected or self._capture is None or self._face_mesh is None:
            return False
        if cv2 is None or mp is None:
            return False

        ear_samples: list[float] = []
        for _ in range(30):
            try:
                ok, frame = self._capture.read()
                if not ok or frame is None:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self._face_mesh.process(rgb)
                if not results or not results.multi_face_landmarks:
                    continue
                lm = results.multi_face_landmarks[0].landmark
                ear_l = _eye_aspect_ratio(lm, _LEFT_EYE)
                ear_r = _eye_aspect_ratio(lm, _RIGHT_EYE)
                ear_samples.append((ear_l + ear_r) / 2.0)
            except Exception:
                continue

        if not ear_samples:
            return False
        avg_ear = sum(ear_samples) / len(ear_samples)
        return avg_ear > 0.15

    def is_connected(self) -> bool:
        return self.connected

    def shutdown(self) -> None:
        self.active = False
        self.connected = False
        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:
                pass
            self._capture = None
        if self._face_mesh is not None:
            try:
                self._face_mesh.close()
            except Exception:
                pass
            self._face_mesh = None

    def get_configurable_fields(self) -> dict[str, Any]:
        return {
            "camera_index": {"type": "integer", "default": 0, "description": "Webcam device index"},
            "ear_threshold": {"type": "float", "default": 0.21, "description": "EAR threshold for blink detection"},
            "consec_frames": {"type": "integer", "default": 2, "description": "Consecutive frames below threshold to register blink"},
            "sample_rate": {"type": "integer", "default": 10, "description": "Frames per second to process"},
        }


class GazeDriver(SensorDriver):
    """Webcam-based gaze estimation using MediaPipe FaceMesh iris landmarks.

    Publishes to topic: events.{studyId}.{runId}.sensor.io.eye_tracker
    """

    def __init__(self) -> None:
        self.sample_rate = 10
        self.active = False
        self.connected = False
        self.camera_index = 0
        self._capture: Any = None
        self._face_mesh: Any = None
        self._is_shared = False

    def get_metadata(self) -> SensorMetadata:
        return SensorMetadata(
            driver_id="gaze",
            sensor_type="eye_tracker",
            display_name="MediaPipe Gaze Estimation",
            version="1.0.0",
            sample_rate=self.sample_rate,
            custom_fields={
                "driverClass": "mediapipe-facemesh",
                "capabilities": ["gaze_estimation", "pupil_diameter"],
            },
        )

    def initialize(self, config: dict[str, Any]) -> bool:
        self.sample_rate = int(
            config.get("sample_rate", config.get("sampleRate", 10))
        )
        self.camera_index = int(
            config.get("camera_index", config.get("cameraIndex", 0))
        )

        shared_capture = config.get("shared_capture")
        shared_face_mesh = config.get("shared_face_mesh")
        
        if shared_capture is not None and shared_face_mesh is not None:
            self._capture = shared_capture
            self._face_mesh = shared_face_mesh
            self._is_shared = True
            self.connected = True
            return True

        self._is_shared = False

        if cv2 is None or mp is None:
            self.connected = False
            return False

        try:
            self._capture = cv2.VideoCapture(self.camera_index)
            if not (self._capture and self._capture.isOpened()):
                self._capture = None
                self.connected = False
                return False
        except Exception:
            self._capture = None
            self.connected = False
            return False

        try:
            self._face_mesh = mp.solutions.face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception:
            if self._capture is not None:
                self._capture.release()
                self._capture = None
            self.connected = False
            return False

        self.connected = True
        return True

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def read(self) -> SensorReading | None:
        if not self.active:
            return None

        # Degraded mode
        if not self.connected or self._capture is None or self._face_mesh is None:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "gaze": {"x": None, "y": None},
                    "pupilDiameter": None,
                    "connected": False,
                },
                metadata={"source": "baseline-unavailable"},
            )

        try:
            ok, frame = self._capture.read()
        except Exception:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "gaze": {"x": None, "y": None},
                    "pupilDiameter": None,
                    "connected": False,
                },
                metadata={"source": "baseline-unavailable"},
            )

        if not ok or frame is None:
            return None

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._face_mesh.process(rgb)

        if not results or not results.multi_face_landmarks:
            return SensorReading(
                timestamp=time.time(),
                data={
                    "gaze": {"x": None, "y": None},
                    "pupilDiameter": None,
                    "connected": True,
                },
                metadata={"source": "mediapipe-facemesh", "face_detected": False},
            )

        landmarks = results.multi_face_landmarks[0].landmark
        gaze_x, gaze_y = _compute_gaze(landmarks)
        pupil_diameter = _compute_pupil_diameter(landmarks)

        return SensorReading(
            timestamp=time.time(),
            data={
                "gaze": {"x": gaze_x, "y": gaze_y},
                "pupilDiameter": pupil_diameter,
                "connected": True,
            },
            metadata={"source": "mediapipe-facemesh", "face_detected": True},
        )

    def calibrate(self) -> bool:
        return self.connected

    def is_connected(self) -> bool:
        return self.connected

    def shutdown(self) -> None:
        self.active = False
        self.connected = False
        if not self._is_shared:
            if self._capture is not None:
                try:
                    self._capture.release()
                except Exception:
                    pass
                self._capture = None
            if self._face_mesh is not None:
                try:
                    self._face_mesh.close()
                except Exception:
                    pass
                self._face_mesh = None

    def get_configurable_fields(self) -> dict[str, Any]:
        return {
            "camera_index": {"type": "integer", "default": 0, "description": "Webcam device index"},
            "sample_rate": {"type": "integer", "default": 10, "description": "Frames per second to process"},
        }


# Backward-compatible alias: __main__.py imports EyeTrackerDriver by name
EyeTrackerDriver = BlinkDetectionDriver

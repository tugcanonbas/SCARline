"""
scarline_carla/pygame_driver.py
--------------------------------
Host-side PyGame keyboard steering driver for the SCARline CARLA client.

Runs on the HOST machine (not inside Docker). Connects directly to the
CARLA server at localhost:2000, finds the ego vehicle (role_name=hero),
opens an 800x600 PyGame window with a live RGB camera feed, and lets the
researcher steer with W/A/S/D or arrow keys.

Usage:
    python -m scarline_carla.pygame_driver

    or directly:
    python python/carla-client/scarline_carla/pygame_driver.py

Environment:
    CARLA_SERVER_HOST  (default: localhost)
    CARLA_SERVER_PORT  (default: 2000)
"""
from __future__ import annotations

import os
import sys
import time
import threading
from contextlib import suppress

# ---------------------------------------------------------------------------
# Optional imports -- fail gracefully so the module can be imported in tests
# ---------------------------------------------------------------------------
try:
    import pygame  # type: ignore
except ImportError:  # pragma: no cover
    pygame = None  # type: ignore

try:
    import carla  # type: ignore
except ImportError:  # pragma: no cover
    carla = None  # type: ignore

try:
    import numpy as np  # type: ignore
except ImportError:  # pragma: no cover
    np = None  # type: ignore

# carla connection - 2026-09-01: 0.9.14 client vs 0.9.16 server version mismatch workaround.
# carla.ColorConverter.Raw triggers an internal Array.h assertion when the client and server
# binary minor versions differ. We bypass it by reading image.raw_data (a bytes object)
# directly — this is a public attribute and is stable across minor versions.

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CARLA_HOST = os.environ.get("CARLA_SERVER_HOST", "localhost")
CARLA_PORT = int(os.environ.get("CARLA_SERVER_PORT", "2000"))

WIN_W = int(os.environ.get("CARLA_DRIVER_WIDTH", "1280"))
WIN_H = int(os.environ.get("CARLA_DRIVER_HEIGHT", "720"))
FPS = 30
POLL_INTERVAL = 2.0  # seconds between hero-vehicle polls when idle

# Control values (instant, not ramped)
THROTTLE = 0.7
BRAKE    = 0.5
STEER    = 0.5

# HUD colours
HUD_BG    = (0, 0, 0, 160)
HUD_TEXT  = (255, 255, 255)
ACCENT    = (0, 200, 100)
WARNING   = (255, 80, 60)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_hero(world) -> object | None:
    """Return the first alive actor with role_name == 'hero', or None."""
    try:
        vehicles = world.get_actors().filter("vehicle.*")
        for actor in vehicles:
            if not getattr(actor, "is_alive", True):
                continue
            role = None
            with suppress(Exception):
                role = actor.attributes.get("role_name", "")
            if role == "hero":
                return actor
    except Exception:
        pass
    return None


def _carla_image_to_surface(image) -> object:
    """Convert a carla.Image to a pygame.Surface (WIN_W x WIN_H)."""
    w, h = image.width, image.height
    raw = bytes(image.raw_data)

    if np is not None:
        array = np.frombuffer(raw, dtype=np.uint8).reshape((h, w, 4))
        # BGRA -> RGB (drop alpha, reverse channel order)
        rgb = array[:, :, :3][:, :, ::-1]
        surface = pygame.surfarray.make_surface(rgb.swapaxes(0, 1))
    else:
        rgb_bytes = bytearray(w * h * 3)
        for i in range(w * h):
            b, g, r = raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]
            rgb_bytes[i * 3]     = r
            rgb_bytes[i * 3 + 1] = g
            rgb_bytes[i * 3 + 2] = b
        surface = pygame.image.frombuffer(bytes(rgb_bytes), (w, h), "RGB")

    if w == WIN_W and h == WIN_H:
        return surface
    return pygame.transform.scale(surface, (WIN_W, WIN_H))


# ---------------------------------------------------------------------------
# HUD drawing
# ---------------------------------------------------------------------------

def _draw_hud(screen, font, vehicle, ctrl, connected: bool) -> None:
    """Draw a minimal HUD overlay."""
    if not connected:
        label = font.render("Waiting for session...", True, WARNING)
        screen.blit(label, (20, WIN_H - 40))
        return

    try:
        v = vehicle.get_velocity()
        speed = round((v.x**2 + v.y**2 + v.z**2) ** 0.5 * 3.6, 1)
    except Exception:
        speed = 0.0

    lines = [
        f"Speed   {speed:>6.1f} km/h",
        f"Throttle {ctrl.throttle:>5.2f}",
        f"Brake    {ctrl.brake:>5.2f}",
        f"Steer    {ctrl.steer:>+6.2f}",
        f"Gear     {'R' if ctrl.reverse else str(ctrl.gear)}",
    ]

    padding = 8
    line_h  = font.get_height() + 4
    box_w   = 200
    box_h   = len(lines) * line_h + padding * 2
    box_x   = 10
    box_y   = WIN_H - box_h - 10

    bg = pygame.Surface((box_w, box_h), pygame.SRCALPHA)
    bg.fill(HUD_BG)
    screen.blit(bg, (box_x, box_y))

    for i, text in enumerate(lines):
        rendered = font.render(text, True, HUD_TEXT)
        screen.blit(rendered, (box_x + padding, box_y + padding + i * line_h))

    legend = [
        "W / Up    Throttle",
        "S / Down  Brake",
        "A / Left  Steer left",
        "D / Right Steer right",
        "Space     Handbrake",
        "R         Reverse",
    ]
    leg_x = WIN_W - 180
    leg_y = 10
    for i, text in enumerate(legend):
        rendered = font.render(text, True, ACCENT)
        screen.blit(rendered, (leg_x, leg_y + i * (font.get_height() + 2)))


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

import ctypes


def _focus_window() -> None:
    """Bring the PyGame window to the foreground on Windows."""
    try:
        hwnd = pygame.display.get_wm_info().get("window")
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 5)  # SW_SHOW
            ctypes.windll.user32.SetForegroundWindow(hwnd)
    except Exception:
        pass


def run() -> None:
    if pygame is None:
        print("pygame_driver: pygame is not installed. Run: pip install pygame>=2.5", flush=True)
        sys.exit(1)
    if carla is None:
        print("pygame_driver: carla package is not installed. Run: pip install carla==0.9.16", flush=True)
        sys.exit(1)
    if np is None:
        print("pygame_driver: numpy is not installed. Run: pip install numpy", flush=True)
        sys.exit(1)

    pygame.init()
    clock = None
    font = None
    screen = None

    # Shared camera frame buffer (written by CARLA sensor callback thread)
    frame_lock = threading.Lock()
    latest_frame = [None]  # latest_frame[0] = pygame.Surface | None

    # State
    client = None
    world = None
    vehicle = None
    camera_sensor = None
    reverse = False

    def attach_camera(veh):
        nonlocal world
        world = client.get_world()
        bp = world.get_blueprint_library().find("sensor.camera.rgb")
        bp.set_attribute("image_size_x", str(WIN_W))
        bp.set_attribute("image_size_y", str(WIN_H))
        bp.set_attribute("fov", "90")
        transform = carla.Transform(
            carla.Location(x=1.6, z=1.7),
            carla.Rotation(pitch=0),
        )
        sensor = world.spawn_actor(bp, transform, attach_to=veh)

        def on_image(image):
            try:
                surf = _carla_image_to_surface(image)
                with frame_lock:
                    latest_frame[0] = surf
            except Exception:
                pass

        sensor.listen(on_image)
        return sensor

    def cleanup_session():
        nonlocal vehicle, camera_sensor, world, screen, font, clock
        if camera_sensor is not None:
            with suppress(Exception, RuntimeError, BaseException):
                try:
                    if getattr(camera_sensor, "is_alive", False) and getattr(camera_sensor, "is_listening", False):
                        camera_sensor.stop()
                except Exception:
                    pass
                if getattr(camera_sensor, "is_alive", False):
                    camera_sensor.destroy()
            camera_sensor = None
        vehicle = None
        clock = None
        if client is not None:
            with suppress(Exception, RuntimeError, BaseException):
                world = client.get_world()
        with frame_lock:
            latest_frame[0] = None
        if screen is not None or pygame.display.get_init():
            with suppress(Exception):
                pygame.display.quit()
                pygame.quit()
            screen = None
            font = None
            print("pygame_driver: session ended / cancelled -- window closed, waiting for next session...", flush=True)

    last_poll = 0.0
    running = True

    try:
        print("pygame_driver: running in background listener mode, waiting for session to start in CARLA...", flush=True)
        while running:
            try:
                # ------------------------------------------------------------
                # (Re-)connect to CARLA when needed
                # ------------------------------------------------------------
                if client is None or world is None:
                    try:
                        client = carla.Client(CARLA_HOST, CARLA_PORT)
                        client.set_timeout(3.0)
                        world = client.get_world()
                        print(f"pygame_driver: connected to CARLA at {CARLA_HOST}:{CARLA_PORT}", flush=True)
                    except Exception:
                        client = None
                        world = None
                        time.sleep(0.5)
                        continue

                # ------------------------------------------------------------
                # Poll for hero vehicle when no active session
                # ------------------------------------------------------------
                if vehicle is None:
                    now = time.monotonic()
                    if now - last_poll >= 0.5:
                        last_poll = now
                        try:
                            if client is not None:
                                world = client.get_world()
                            hero = _find_hero(world)
                        except Exception:
                            client = None
                            world = None
                            continue
                        if hero is not None and getattr(hero, "is_alive", False):
                            vehicle = hero
                            try:
                                pygame.init()
                                pygame.font.init()
                                pygame.display.init()
                                clock = pygame.time.Clock()
                                screen = pygame.display.set_mode((WIN_W, WIN_H))
                                pygame.display.set_caption(f"SCARline -- Keyboard Driver  |  Session Active [{vehicle.type_id}]")
                                font = pygame.font.SysFont("monospace", 14)
                                _focus_window()

                                camera_sensor = attach_camera(vehicle)
                                print(f"pygame_driver: hero vehicle found ({vehicle.type_id}) -- new window opened & keyboard control active", flush=True)
                            except Exception as err:
                                print(f"pygame_driver: failed to attach camera / display: {err}", flush=True)
                                cleanup_session()

                    if vehicle is None:
                        time.sleep(0.05)
                        continue

                # ------------------------------------------------------------
                # Verify vehicle liveness and session match against CARLA world
                # ------------------------------------------------------------
                try:
                    if world is None or client is None:
                        cleanup_session()
                        continue
                    current_hero = _find_hero(world)
                    if current_hero is None:
                        print("pygame_driver: hero vehicle despawned -- session ended", flush=True)
                        cleanup_session()
                        continue
                    if current_hero.id != vehicle.id:
                        print(f"pygame_driver: hero vehicle changed ({vehicle.id} -> {current_hero.id}) -- switching session", flush=True)
                        cleanup_session()
                        continue
                    if not getattr(vehicle, "is_alive", False):
                        print("pygame_driver: hero vehicle not alive -- session ended", flush=True)
                        cleanup_session()
                        continue
                    _transform = vehicle.get_transform()
                    if _transform is None:
                        print("pygame_driver: hero vehicle transform is None -- session ended", flush=True)
                        cleanup_session()
                        continue
                except Exception as actor_err:
                    print(f"pygame_driver: hero vehicle destroyed / disconnected ({actor_err}) -- session ended", flush=True)
                    cleanup_session()
                    continue

                # ------------------------------------------------------------
                # Process pygame events for active window
                # ------------------------------------------------------------
                if screen is not None and pygame.display.get_init():
                    for event in pygame.event.get():
                        if event.type == pygame.QUIT:
                            print("pygame_driver: window closed by user", flush=True)
                            cleanup_session()
                            break
                        if event.type == pygame.KEYDOWN:
                            if event.key in (pygame.K_ESCAPE, pygame.K_q):
                                print("pygame_driver: close requested via keyboard", flush=True)
                                cleanup_session()
                                break
                            if event.key == pygame.K_r and vehicle is not None:
                                reverse = not reverse

                if vehicle is None:
                    continue

                # ------------------------------------------------------------
                # Apply controls to hero vehicle
                # ------------------------------------------------------------
                keys = pygame.key.get_pressed()
                throttle_val = THROTTLE if (keys[pygame.K_w] or keys[pygame.K_UP]) else 0.0
                brake_val = BRAKE if (keys[pygame.K_s] or keys[pygame.K_DOWN]) else 0.0
                steer_val = 0.0
                if keys[pygame.K_a] or keys[pygame.K_LEFT]:
                    steer_val -= STEER
                if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
                    steer_val += STEER
                handbrake = bool(keys[pygame.K_SPACE])

                ctrl = carla.VehicleControl(
                    throttle=throttle_val,
                    brake=brake_val,
                    steer=max(-1.0, min(1.0, steer_val)),
                    hand_brake=handbrake,
                    reverse=reverse,
                )
                try:
                    vehicle.apply_control(ctrl)
                except Exception:
                    print("pygame_driver: hero vehicle destroyed / disconnected -- session ended", flush=True)
                    cleanup_session()
                    continue

                # ------------------------------------------------------------
                # Render
                # ------------------------------------------------------------
                with frame_lock:
                    frame = latest_frame[0]

                if screen is not None and pygame.display.get_init():
                    if frame is not None:
                        screen.blit(frame, (0, 0))
                    else:
                        screen.fill((30, 30, 30))
                        if font is not None:
                            placeholder = font.render("Camera initialising...", True, (120, 120, 120))
                            screen.blit(placeholder, (WIN_W // 2 - placeholder.get_width() // 2, WIN_H // 2))

                    if font is not None:
                        _draw_hud(screen, font, vehicle, ctrl, connected=True)
                    pygame.display.flip()

                if clock is not None:
                    clock.tick(FPS)
                else:
                    time.sleep(1.0 / FPS)

            except Exception as loop_err:
                print(f"pygame_driver: loop warning: {loop_err}", flush=True)
                cleanup_session()
                client = None
                world = None
                time.sleep(1.0)

    finally:
        cleanup_session()
        with suppress(Exception):
            pygame.quit()
        print("pygame_driver: exited", flush=True)


if __name__ == "__main__":
    run()

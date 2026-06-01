# Deuda_Tecnica.md — SCARline

## Sprint History
| ID | Módulo | Descripción | Scope violations | Tests inicio→cierre | Intentos | Correcciones |
|---|---|---|---|---|---|---|
| S-001 | python/io-client | BlinkDetectionDriver: reemplaza eye_tracker stub con driver MediaPipe EAR + degraded mode + 3 tests behavioral | 0 | 52→55 pass / 5→5 fail | 1 (+1 rechazo plan v1) | Archivos autorizados expandidos; tests string→execSync Python |
| S-002 | packages/contracts | IO Event Types: +4 schemas Zod (io.blink, io.gesture, io.eye_tracker, io.heart_rate) en rabbitmq.ts + 4 tests | 0 | 55→59 pass / 5→5 fail | 1 | — |
| S-003 | python/io-client | Eye tracker gaze: _compute_gaze() + _compute_pupil_diameter() + calibrate() 30-frame + payload combinado blink+gaze | 0 | 59→62 pass / 5→5 fail | 1 | — |
| S-004 | python/io-client | HeartRateDriver: backends bleak+serial, import guards, degraded mode, asyncio.run() sync bridge | 0 | 62→65 pass / 5→5 fail | 1 | — |
| S-005 | python/io-client | logitech_g29.py: degraded mode payload correcto (steeringAngle/throttle/brake=null) + 2 tests Windows compat | 0 | 65→67 pass / 5→5 fail | 1 | — |
| S-006 | python/io-client + __main__.py | GazeDriver desacoplado: sensor_type=eye_tracker, topic sensor.io.eye_tracker, shared_capture opcional, DRIVER_FACTORIES registrado | 0 | 67→70 pass / 5→5 fail | 1 | Test existente adaptado per restricción autorizada |
| S-007 | python/io-client | HeartRateDriver: asyncio.run() en read() → threading.Thread daemon + _ble_loop persistente + threading.Event shutdown | 0 | 70→72 pass / 5→5 fail | 1 | — |
| S-008 | tests/infra | topology.test.mjs: isBashAvailable adaptado para rechazar WSL en Windows, resolviendo test skips cross-platform | 0 | 73 pass, 4 fail → 73 pass, 0 fail (4 skipped) | 1 | Path interpolation attempts discard by strict skip req |
| S-009 | python/mock-simulator | apply-control null-safe: float(None)→mantener estado + key alias steer/steeringAngle + try/except wrapper | 0 | 73→74 pass / 0 fail / 4 skip | 1 | Bug preexistente detectado en verificación manual E2E |
| S-010 | python/io-client | Dockerfile multi-stage build: reduce tamaño imagen de 936MB a 462MB, elimina dependencias de compilación y ejecuta como usuario no-root scarline | 0 | 74→74 pass / 0 fail / 4 skip | 1 | Eliminado libgl1 para evitar dependencias innecesarias de Mesa/X11 |
| S-011 | infra/database | Habilita pg_stat_statements y agrega 4 índices en session_events (routing_key, created_at, session_id, session_routing composite) | 0 | 74→74 pass / 0 fail / 4 skip | 1 | — |

## Backlog
### 🔴 Crítico
- [x] ~~[ISSUE-001] pnpm no disponible en PATH de Windows — impide build de workspace, widget CSS, y scripts — evidencia:`where.exe pnpm` returns empty~~
- [x] ~~[ISSUE-002] Sensor layer vacío: eye_tracker.py y heart_rate.py son stubs baseline que devuelven None — no hay driver funcional con MediaPipe para detección visual (parpadeo, gestos) — evidencia:`python/io-client/scarline_io/drivers/eye_tracker.py:28` returns `False`~~
- [x] ~~[ISSUE-015] mock-simulator crashea con float(None) en apply-control con payload degraded~~
- [x] ~~[ISSUE-A] imagen scarline-io-client pesa 936 MB porque el Dockerfile instala herramientas de build en la imagen final~~

### 🟠 Alto
- [x] ~~[ISSUE-003] widgets dist.css desactualizado: test `widgets dist.css stays up to date` falla porque Tailwind build script no puede ejecutar (pnpm/node_modules) — evidencia:`node --test tests/contracts/contracts.test.mjs` 1 fail~~
- [x] ~~[ISSUE-004] 4 tests infra launcher fallan: scripts bash asumen Linux/macOS — validación pnpm, compose wrapper, CARLA paths, IPC socket TCP fallback — evidencia:`node --test tests/infra/topology.test.mjs` 4 fail~~
- [x] ~~[ISSUE-B] session_events ocupa 279 MB sin índices en columnas frecuentes + pg_stat_statements deshabilitado~~

### 🟡 Medio
- [x] ~~[ISSUE-005] logitech_g29.py usa `evdev` (Linux-only) — no funcional en entorno Windows de desarrollo — evidencia:`python/io-client/scarline_io/drivers/logitech_g29.py:8-11`~~
- [x] ~~[ISSUE-006] IO Event Types en contracts incompletos — faltan tipos para nuevos sensores (blink, gesture, heart_rate como subtipo separado) — evidencia:`packages/contracts/src/rabbitmq.ts:63-67`~~
- [x] ~~[ISSUE-013] GazeDriver acoplado a BlinkDetectionDriver — gaze+pupil data viaja en payload de blink_detection por limitación de SensorDriver.read() single-return — desacoplar requiere: nuevo GazeDriver en eye_tracker.py + entrada en DRIVER_FACTORIES (__main__.py) + topic sensor.io.eye_tracker separado~~
- [x] ~~[ISSUE-014] HeartRateDriver crea event loop por cada read() BLE — asyncio.run() en polling loop genera overhead por frame — solución: event loop persistente en hilo dedicado (threading.Thread + asyncio.run_coroutine_threadsafe)~~
- [x] ~~[ISSUE-016] mediapipe==0.10.x en Python 3.12 Windows no incluye `mediapipe.python.solutions` precompilado — BlinkDetectionDriver y GazeDriver arrancan en degraded mode en el host de desarrollo; solución: pin mediapipe==0.10.14 (última con solutions API en Win/Py312) o migrar a Task API en eye_tracker.py~~

### Features incompletas
- [x] ~~[ISSUE-010] MediaPipe blink/gesture sensor driver: crear driver que detecte parpadeos y gestos via webcam local y publique eventos RabbitMQ — falta: driver completo, config, tests, integración con io-client~~
- [x] ~~[ISSUE-011] Eye tracker real: integrar SDK de eye tracking real (Tobii/Pupil Labs) o MediaPipe FaceMesh — falta: driver implementation, calibración funcional~~
- [x] ~~[ISSUE-012] Heart rate real: integrar sensor BLE/USB de frecuencia cardíaca — falta: protocolo BLE, driver, config~~

## Resuelto
<!-- tachar ~~texto~~ al cerrar sprint. Nunca eliminar. -->
- ~~[ISSUE-002]~~ BlinkDetectionDriver implementado — EAR + degraded mode — S-001
- ~~[ISSUE-010]~~ MediaPipe blink driver completo + config + tests — S-001
- ~~[ISSUE-006]~~ 4 IO event types + schemas Zod en rabbitmq.ts — S-002
- ~~[ISSUE-011]~~ Gaze estimation + pupil diameter via MediaPipe iris landmarks — S-003
- ~~[ISSUE-012]~~ HeartRateDriver con backends bleak + serial + degraded mode — S-004
- ~~[ISSUE-005]~~ evdev import guard + degraded mode payload en logitech_g29.py — S-005
- ~~[ISSUE-013]~~ GazeDriver independiente con sensor_type=eye_tracker + shared_capture — S-006
- ~~[ISSUE-014]~~ BLE event loop persistente en daemon thread + shutdown con join(timeout=2.0) — S-007
- ~~[ISSUE-001]~~ pnpm 10.7.1 instalado manualmente via npm install -g — fuera de scope AG
- ~~[ISSUE-003]~~ pnpm widgets:build-css ejecutado manualmente — desbloqueado por ISSUE-001
- ~~[ISSUE-004]~~ tests infra launcher skips condicionados para cross-platform Windows/WSL — S-008
- ~~[ISSUE-015]~~ apply-control null-safe + key alias steer/steeringAngle — S-009
- ~~[ISSUE-016]~~ pin mediapipe==0.10.14 en requirements.txt — acción manual (no sprint)
- ~~[ISSUE-A]~~ Dockerfile multi-stage build en io-client — S-010
- ~~[ISSUE-B]~~ postgresql.conf + migration 001 índices session_events + pg_stat_statements habilitado — S-011

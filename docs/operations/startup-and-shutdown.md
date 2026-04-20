# Startup And Shutdown

Use the launcher as the primary operational interface.

## Startup Procedure

1. Choose the correct mode:
   - `./scarline start`
   - `./scarline start --dev`
   - `./scarline start --no-carla`
   - `./scarline start --no-overlay`
   - `./scarline start --widget-test`
2. Confirm the gateway is reachable on the configured platform port.
3. Open `/admin`, `/api/health`, and `/docs`.
4. Verify that core dependencies report healthy or intentionally degraded states.

## Health Priority

The minimum healthy path for normal operations is:

1. PostgreSQL
2. RabbitMQ
3. CoreAPI
4. Admin Panel and Overlay Web
5. Sim-Bridge and simulator client
6. I/O client and required sensor drivers
7. Desktop overlay, if the protocol depends on it

## Shutdown Procedure

- use `./scarline stop` for graceful stop
- use `./scarline restart` for controlled restart
- avoid using database reset operations outside development or explicit test environments

## During Bring-Up

Use:

- `./scarline status`
- `./scarline logs [component]`
- the Admin `Startup` and `Components` views

These are the fastest way to correlate launcher state with UI-visible health.

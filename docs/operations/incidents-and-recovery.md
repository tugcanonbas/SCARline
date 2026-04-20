# Incidents And Recovery

Incidents in SCARline are usually dependency or integration failures that occur while the persisted study model remains intact.

## Common Incident Classes

- auth or authorization failures
- CoreAPI, PostgreSQL, or RabbitMQ outage
- simulator disconnect or adapter heartbeat expiry
- sensor driver degradation
- overlay window or display-control failure
- export pipeline failure

## Response Sequence

1. stabilize the active participant session
2. establish which dependency actually failed
3. capture logs, session identifiers, and timestamps
4. recover in dependency order
5. document the operational impact in notes and post-run evidence

## Dependency Order

1. PostgreSQL
2. RabbitMQ
3. CoreAPI
4. Sim-Bridge
5. simulator and I/O clients
6. overlay services

## Recovery Hints

- database issue: restore connectivity first; nothing else is trustworthy until persistence is back
- broker issue: restore message flow before expecting realtime and command execution to normalize
- overlay issue: inspect process-manager controls, display topology, and window actions
- sensor issue: determine whether the run can proceed in degraded mode and record that decision

## Communication Guidance

- give operators immediate safe action guidance first
- treat pause/continue/cancel as an explicit decision
- keep one consistent timeline of what happened across services

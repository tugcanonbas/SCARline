# Extending CoreAPI And Contracts

CoreAPI changes should start from the shared contract model, not from an ad hoc route implementation.

## Safe Change Sequence

1. update or add schemas in `packages/contracts`
2. update CoreAPI route handling and validation
3. update any Admin Panel or client consumers
4. update tests that cover the changed route family or payload
5. update docs in this site

## CoreAPI Responsibility Areas

- onboarding and authentication
- system configuration and component health
- studies, participants, conditions, and sessions
- CARLA presets and study-level simulator configuration
- sensor configuration and status
- layouts, widgets, and triggers
- exports
- WebSocket subscriptions and realtime fanout

## Contract Areas To Keep In Sync

- REST DTOs
- roles and state enums
- websocket channels
- RabbitMQ message envelopes and routing helpers
- layout and widget schemas
- process-manager command schemas

## Avoid These Mistakes

- changing a payload in CoreAPI without updating `packages/contracts`
- adding direct backend REST coupling instead of using RabbitMQ
- pushing auth or role checks only into the browser

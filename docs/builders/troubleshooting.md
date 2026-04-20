# Troubleshooting

This page is for engineers diagnosing implementation or environment issues while building.

## Common Fault Zones

- launcher mode mismatch
- stale or invalid contract assumptions
- auth redirect behavior in SvelteKit loaders
- missing RabbitMQ message flow
- simulator adapter heartbeat loss
- overlay asset or window-control mismatch

## Good Debugging Sequence

1. confirm the intended runtime mode
2. inspect the relevant contract or schema
3. inspect logs for the owning service
4. verify whether the failure is synchronous REST, asynchronous messaging, or UI subscription related
5. reproduce with the smallest relevant test

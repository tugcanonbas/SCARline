# Contracts And CoreAPI

## Contract Modules

`packages/contracts/src` is organised by domain.

| Module | Contains |
| --- | --- |
| `common.ts` | `UuidSchema`, `IsoDateTimeSchema`, `JsonObjectSchema` |
| `api.ts` | Response envelopes and the error shape |
| `auth.ts` | Login, tokens, all token claim shapes, cookie names and options |
| `config.ts` | `ScarlineConfigSchema` and the per-service secret subsets |
| `domain.ts` | Roles, study status, users, studies, participants, conditions, sessions, data policy |
| `session.ts` | Session status and the transition table |
| `readiness.ts` | Readiness check keys and payload |
| `health.ts` | Component ids, health statuses, platform health |
| `events.ts` | Session event query and aggregate response |
| `export.ts` | Export job status and progress |
| `layout.ts` | Layouts, widget instances, overlay scopes, host commands and events |
| `widget.ts` | Widget manifests (legacy and modern) and binding data |
| `trigger.ts` | Trigger expressions and action types |
| `simulator.ts` | The full adapter protocol and CARLA configuration |
| `sensor.ts` | Sensor status and per-modality event payloads |
| `io.ts` | Driver manifests, IO session configuration, lifecycle commands |
| `messaging.ts` | Exchanges, routing key patterns, message envelope |
| `websocket.ts` | Channels, subscriptions, server messages |

`index.ts` re-exports everything and declares `jsonSchemaSources`, the map of schemas
exported as JSON Schema for the Python services.

## Adding A Field To An Existing Payload

1. Add it to the schema in `packages/contracts`. Remember most schemas are `.strict()`.
2. `npm run build -w @scarline/contracts`.
3. Update the producer — usually a CoreAPI route or a service that publishes an event.
4. Update every consumer. TypeScript will point at them; the Python services need their
   parsing updated by hand.
5. Add it to `jsonSchemaSources` if a non-TypeScript service must validate it.
6. Extend the contract test and the affected service tests.
7. Update the reference page in these docs.

Adding an **optional** field is backward compatible. Adding a required one is not: every
producer must emit it before any consumer requires it.

## Adding A REST Route

Routes live in `services/core-api/src/routes/`, grouped by domain and registered from
`app.ts`.

```ts
app.post("/api/v1/studies/:studyId/things", {
  preHandler: [authenticate(auth), requirePasswordReady, requireAnyRole("admin", "researcher")],
  schema: {
    params: StudyParamsSchema,
    querystring: EmptyObjectSchema,
    headers: AuthHeadersSchema,
    body: CreateThingSchema,
  },
}, async (request, reply) => {
  const { studyId } = StudyParamsSchema.parse(request.params);
  const body = CreateThingSchema.parse(request.body);
  await ensureStudyAccess(request, pool, studyId);
  await requireEditableStudy(pool, studyId);
  // ...
  return reply.status(201).send(success(mapThing(row)));
});
```

Conventions every route follows:

- `preHandler` is `authenticate(auth)`, then `requirePasswordReady`, then
  `requireAnyRole(...)`.
- `schema` declares `params`, `querystring`, and `headers` even when empty, so unexpected
  input is rejected rather than ignored.
- Study-scoped routes call `ensureStudyAccess` — role alone is never sufficient.
- Routes that mutate configuration call `requireEditableStudy`, which enforces the
  `draft`/`configured` rule and refuses while a session is prepared or running.
- Success responses use the `success()` envelope: `{ success, data, error }`.
- Errors are thrown as `ApiProblem(status, CODE, message, details)`.
- Audited operations call `recordActivity` inside the same transaction.

## Errors

`ApiProblem` carries an HTTP status, an `UPPER_SNAKE_CASE` code, a message, and
structured details. The global error handler also maps Zod failures to
`400 VALIDATION_ERROR` with the issue list, unique-violation `23505` to `409 CONFLICT`,
and foreign-key violation `23503` to `409 RESOURCE_IN_USE`. Anything unclassified
becomes `500 INTERNAL_ERROR` and is logged; the message is never leaked to the client.

Every error response carries the Fastify `requestId`, so a report can be traced to a log
line.

## Publishing An Event

Never publish inside a request handler. Enqueue it in the same transaction:

```ts
await enqueueMessage(client, createEnvelope({
  routingKey: `events.${studyId}.${sessionId}.trigger.rule-fired`,
  studyId,
  sessionId,
  correlationId: commandId,
  payload: { ruleId, action },
}));
```

`createEnvelope` fills the id, timestamp, producer, and source metadata.
`enqueueMessage` picks the exchange from the routing key prefix and writes the outbox
row. The publisher drains it after commit.

Routing keys are schema-validated, so a malformed key fails at enqueue time rather than
at the broker.

## Consuming An Event

Register a consumer on the `RabbitConnection`, and claim the message inside the handling
transaction:

```ts
if (!(await claimInboxMessage(client, message.id, "core-api.my-consumer"))) {
  await client.query("COMMIT");
  return;                       // already handled
}
```

A handler that throws nacks without requeue, so the message dead-letters instead of
looping.

## Adding A Lifecycle Participant

If a new component must acknowledge session transitions:

1. Add its name to `#requiredComponents` in `services/core-api/src/sessions/service.ts`,
   with the condition under which it is required.
2. Make the component consume `commands.<name>.session-<action>` and reply with an
   acknowledgement on `events.<study>.<session>.command.ack`, using the
   `{ commandId, component, status, error, warning }` shape.
3. Give it a command journal so a restart replays results rather than re-executing.
4. Make it heartbeat on `events.system.global.component.heartbeat` so component status
   and readiness can see it.

A required component that never acknowledges will time the command out and fail the
session — which is the intended behaviour, but make sure the requirement condition is
right.

## Adding A WebSocket Channel

1. Add the channel to `WebSocketChannelSchema` and a data message variant to
   `WebSocketDataMessageSchema` in `contracts/src/websocket.ts`.
2. Map routing keys to it in `RealtimeHub.broadcastEvent`, or broadcast explicitly with
   `hub.broadcast(channel, data, studyId, sessionId)`.
3. Subscribe in `apps/admin-panel/src/lib/stores/realtime.ts`.

Remember that every channel except `system.health` requires a `studyId` filter on
subscribe.

## Read Next

- [Contracts](/reference/contracts)
- [CoreAPI Routes](/reference/core-api)
- [Messaging](/reference/messaging)

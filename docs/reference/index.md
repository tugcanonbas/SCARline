# Reference Overview

Curated lookup pages for the surfaces you need exact values for. This is not a generated
API manual — it is the set of facts that are tedious to rediscover from source.

## Pages

| Page | Answers |
| --- | --- |
| [CoreAPI Routes](/reference/core-api) | What endpoint exists, what method, which roles |
| [Realtime Channels](/reference/realtime) | WebSocket channels, subscription shape, authentication |
| [Messaging](/reference/messaging) | Exchanges, queues, routing keys, envelope shape |
| [Contracts](/reference/contracts) | Which schema module owns which shape, and every enum |
| [Database Schema](/reference/database) | Tables, their relationships, and key columns |
| [Widgets And Layouts](/reference/widgets-and-layouts) | Manifest fields, layout and instance fields, runtime API |
| [Admin Panel And RBAC](/reference/admin-panel) | Route map and the role each screen requires |
| [Configuration Keys](/reference/configuration) | Every `config.yml` key with its type and default |
| [Ports And Endpoints](/reference/ports) | Every address the platform binds or calls |
| [Error Codes](/reference/error-codes) | What a code means and what to do about it |

## Conventions Used Throughout

- REST is versioned at `/api/v1`. `/health` and `/ready` sit outside it because they are
  infrastructure probes.
- Successful responses are `{ "success": true, "data": …, "error": null }`; failures are
  `{ "success": false, "data": null, "error": { code, message, details, requestId } }`.
- Error codes are `UPPER_SNAKE_CASE` and stable — treat them as API, not as prose.
- Identifiers are UUIDs; timestamps are ISO-8601 with an offset.
- Most request schemas are `strict`: an unexpected field is a `400`, not an ignored one.
- Pagination is cursor-based. A response carries `nextCursor` (or `nextBeforeId` on the
  id-ordered endpoints); `null` means the end.

# Security Model

SCARline is a lab platform that binds to `127.0.0.1` by default. Within that scope it
still treats authentication, authorisation, and asset access as hard boundaries.

## Identities

| Identity | Credential | Used by |
| --- | --- | --- |
| User | Access token + refresh cookie | Admin Panel |
| User WebSocket | Single-use ticket | `/ws` |
| Overlay host | Control token from a shared secret | `/overlay-control` |
| Overlay renderer | Scoped bootstrap token → render-session cookie → WebSocket ticket | `/overlay-runtime` |
| Simulator adapter | `SIM_BRIDGE_ADAPTER_SECRET` | Sim-Bridge `/adapter` |

## Passwords

Hashed with scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), stored as a
single self-describing string, and verified in constant time. A hash whose parameters do
not match the current cost is rejected rather than silently accepted.

New and changed passwords must be at least 12 characters. Login accepts an existing
credential of any length, so raising the policy never locks anyone out — it just forces
a change at the next reset. Usernames match case-insensitively.

A disabled account fails authentication and has all of its auth sessions revoked.

## Access Tokens And Refresh Rotation

Access tokens are JWTs signed with `JWT_ACCESS_SECRET`, with a fixed issuer
(`scarline-core-api`) and audience (`scarline-admin-panel`), a `jti`, the auth session
id, the username, display name, and roles. Lifetime comes from
`api.access_token_ttl_minutes`.

Refresh tokens are random values stored **hashed and peppered** with
`REFRESH_TOKEN_PEPPER`, never in plaintext. They live in the
`__Host-scarline_refresh` cookie: `httpOnly`, `secure`, `sameSite: strict`, `path: /`.
The `__Host-` prefix means the browser refuses the cookie unless it is host-scoped and
secure.

Every refresh rotates the token and records the old hash. **Presenting a rotated token
again revokes the whole auth session** — that is the stolen-token detection, and it
means a replay costs the attacker the session rather than granting one.

Changing a password revokes the refresh cookie. Deactivating a user or resetting their
password revokes all of their sessions.

Login is rate-limited to 10 requests per minute, refresh to 30; the global limit is 300
per minute.

## Origin Checking

`POST /api/v1/auth/login`, `/refresh`, `/logout`, and `/change-password` require an
`Origin` header present in `api.allowed_origins`, and a JSON content type. An
unrecognised origin fails with `ORIGIN_DENIED`. Combined with `sameSite: strict`, this
closes cross-site request forgery against the authentication endpoints.

## Role-Based Access Control

Four roles: `admin`, `researcher`, `operator`, `observer`.

| Role | Can |
| --- | --- |
| `admin` | Everything, including users, devices, and system status; implicit access to every study |
| `researcher` | Design and operate studies they are a member of; queue exports |
| `operator` | Operate sessions on their studies; annotate; trigger widgets |
| `observer` | Read studies, sessions, and events they have access to |

Enforcement is layered:

1. **CoreAPI** authenticates the bearer token, rejects a principal that still needs a
   password change (`PASSWORD_CHANGE_REQUIRED`), and checks the route's required roles.
2. **Study scoping** — every study-scoped route calls `requireStudyAccess`, which
   requires an `admin` role or a `study_users` membership row. Listing endpoints apply
   the same predicate in SQL, so a non-member simply does not see the study.
3. **Admin Panel loaders and actions** re-check the role server-side before rendering or
   mutating.

Hidden buttons in the browser are a usability affordance, not a boundary. The panel
disables controls and explains why, but the server is what enforces it.

## Overlay Credentials

A participant window must render study content without ever holding a user token.

```mermaid
sequenceDiagram
    participant UI as Admin Panel
    participant API as CoreAPI
    participant R as Renderer

    UI->>API: POST /overlay/render-grants (scope)
    API->>API: check study access; browser mode needs a live session
    API-->>UI: single-use bootstrap token + launch URL
    UI->>R: open launch URL (#bootstrap=<token>)
    R->>API: POST /overlay/bootstrap
    API-->>R: __Host-scarline_overlay render-session cookie
    R->>API: POST /overlay/websocket-ticket
    API-->>R: single-use ticket
    R->>API: WS /overlay-runtime
```

Every token carries the full scope — renderer mode, study, session, condition, layout,
and optionally one instance. Bootstrap tokens and WebSocket tickets are single-use and
recorded in `overlay_credentials`; the render-session cookie is `__Host-`-prefixed,
`httpOnly`, `secure`, `sameSite: strict`, and expires after
`api.overlay_renderer_session_ttl_hours`. A request for a widget outside the scope is
refused with `OVERLAY_SCOPE_MISMATCH`.

The desktop overlay host is separate: it authenticates with `OVERLAY_CONTROL_SECRET`
compared in constant time, exchanges it for a control token, and connects to
`/overlay-control`. A host that changes its announced identity on an existing connection
is disconnected.

## WebSocket Authentication

All three sockets authenticate before upgrade, and accept the credential either as a
bearer header or as a `Sec-WebSocket-Protocol` entry, since browsers cannot set headers
on a WebSocket:

| Socket | Protocol prefix |
| --- | --- |
| `/ws` | `scarline.user-ticket.` |
| `/overlay-control` | `scarline.overlay-control.` |
| `/overlay-runtime` | `scarline.overlay-ticket.` |

## Asset Containment

Overlay Web and the Admin Panel both serve widget assets from disk. Every request is
rejected if the path contains a NUL byte, and the resolved path — after `realpath`, so
symlinks are followed first — must stay inside the widgets root. A symlink pointing
outside is refused, not followed.

Export downloads apply the same rule against `api.exports_directory`, and an artifact
path that escapes it fails with `INVALID_EXPORT_PATH` rather than being served.

## Input Validation

Every request body, query string, route parameter, and message envelope is parsed with a
Zod schema from `packages/contracts`, and most are `strict` — an unexpected field is an
error. Validation failures become `400 VALIDATION_ERROR` with the issue list. The same
schemas validate RabbitMQ envelopes and adapter frames, so a malformed message is
dead-lettered rather than processed.

Sim-Bridge caps adapter frames at `sim_bridge.maximum_websocket_message_bytes`.

## Response Headers

Overlay Web sets `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, and
a `permissions-policy` disabling camera, microphone, geolocation, payment, and USB.
Widget shells are served with a content security policy and `no-store`. The widget
itself runs in a sandboxed iframe with an opaque origin and reaches the host page only
through the `SCARline` bridge.

## Deployment Notes

The default stack is a single-machine lab setup:

- every published port binds to `127.0.0.1`
- there is no TLS terminator in the stack
- `__Host-` cookies require a secure context, which browsers grant to `localhost`

Exposing the platform beyond one machine means adding TLS, restricting
`api.allowed_origins`, replacing `BOOTSTRAP_ADMIN_PASSWORD`, and reviewing every port
binding. None of that is configured out of the box.

## Read Next

- [Accounts And Access](/operations/accounts-and-access)
- [Admin Panel And RBAC](/reference/admin-panel)
- [Secrets And .env](/cli/secrets)

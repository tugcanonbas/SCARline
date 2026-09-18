# Accounts And Access

## The First Administrator

There is no onboarding wizard. CoreAPI creates the first account itself: when the `users`
table is empty it inserts one user with `bootstrap.admin_username` from `config.yml`
(`admin` by default) and `BOOTSTRAP_ADMIN_PASSWORD` from `.env`, gives it the `admin`
role, and marks the password as needing a change.

The bootstrap is retried every five seconds until it succeeds, and `GET /ready` stays
`503` until it does — so a database that is not yet accepting connections delays the
whole platform rather than starting it half-initialised.

Once any user exists, the bootstrap path never runs again. Changing
`BOOTSTRAP_ADMIN_PASSWORD` afterwards has no effect.

::: warning
`BOOTSTRAP_ADMIN_PASSWORD` is copied from `.env.example`, where it is `scarline`. Treat
it as a known value and change the account password at first sign-in — which the
platform forces anyway.
:::

## First Sign-In

Because the account has `password_reset_required`, the first sign-in redirects to
`/change-password` and no other screen is reachable. Setting a new password of at least
12 characters clears the flag and revokes the refresh cookie, so you sign in again with
the new credential.

The same applies to every account an administrator creates or resets.

## Roles

| Role | Scope |
| --- | --- |
| `admin` | System administration plus every study, without needing membership |
| `researcher` | Design and operate studies they are a member of; queue exports |
| `operator` | Operate sessions on studies they are a member of; annotate and trigger widgets |
| `observer` | Read studies, sessions, and events they have access to |

Roles are additive — an account can hold several. An account created with no roles
defaults to `observer`.

## Creating Accounts

**Settings → User Accounts** (admin only):

- **Create** — username, temporary password, display name, email, and roles. The account
  is created with `password_reset_required`.
- **Update** — display name, email, active flag, and roles. Providing a password also
  issues a reset. Deactivating an account revokes every one of its auth sessions
  immediately.

Usernames allow letters, digits, `_`, `.`, and `-`, and match case-insensitively at
login.

**Researchers** is a filtered view of the same accounts: it lists users holding the
`researcher` role, with their profile and study assignments.

## Study Membership

Roles say what an account may do; membership says which studies it may do it to.

Creating a study adds its creator as a member. Members are managed through
`GET/POST/DELETE /api/v1/studies/:studyId/users`. Every study-scoped request checks
membership — `admin` bypasses it, anyone else gets `403 STUDY_ACCESS_DENIED`. List
endpoints apply the same predicate in SQL, so a non-member does not see the study at
all.

This is why an operator who "cannot see the study" usually needs a membership row, not a
different role.

## Sessions And Tokens

| Credential | Lifetime | Notes |
| --- | --- | --- |
| Access token | `api.access_token_ttl_minutes` | JWT in memory, sent as a bearer token |
| Refresh cookie | `api.refresh_token_ttl_days` | `__Host-scarline_refresh`, rotated on every refresh |
| WebSocket ticket | `api.overlay_token_ttl_minutes` | Single use |

Reusing a rotated refresh token revokes the entire auth session — a replay costs the
session rather than granting one. Expect it to log you out if you restore a browser
profile from a backup.

## Common Access Problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| Stuck on `/change-password` | `password_reset_required` is set | Set a password of at least 12 characters |
| Everything redirects to `/startup` | CoreAPI `/ready` is not `200` | Check PostgreSQL, RabbitMQ, and the bootstrap |
| `403 You do not have access to this screen` | The route needs a role the account lacks | Add the role under Settings → User Accounts |
| `403 STUDY_ACCESS_DENIED` | Not a member of that study | Add them to the study's users |
| `401 INVALID_CREDENTIALS` with a correct password | The account is deactivated | Re-activate it |
| `403 ORIGIN_DENIED` at login | The browser origin is not in `api.allowed_origins` | Add the origin and restart |
| Logged out unexpectedly | Password change, deactivation, admin reset, or a replayed refresh token | Sign in again |

## Auditing

`GET /api/v1/activity` returns the administrative audit trail — user creation and
updates, password resets, study transitions, session lifecycle requests, export
queueing — with filters for action and entity type.
`GET /api/v1/studies/:studyId/activity` scopes it to one study and is available to
`admin`, `researcher`, and `observer`.

## Read Next

- [Security Model](/platform/security)
- [Admin Panel And RBAC](/reference/admin-panel)
- [Study Setup](/operations/study-setup)

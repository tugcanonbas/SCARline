# UI And RBAC

The Admin Panel is organized around protected route areas and server-side role enforcement.

## Main Route Areas

| Route area | Purpose |
| --- | --- |
| `startup` | platform bring-up and bootstrap visibility |
| `login` | sign-in |
| `onboarding/system` | first-run system config |
| `onboarding/researcher` | first admin-capable account creation |
| `dashboard` | health and recent activity |
| `user-studies` | study creation and nested setup flows |
| `session-logs` | persisted event review |
| `exports` | artifact creation and progress |
| `researchers` | researcher profile and assignment management |
| `settings/system` | runtime configuration and process-manager controls |
| `settings/users` | account and role administration |
| `settings/devices` | device and display metadata |
| `settings/components` | component health |
| `documentation` | compatibility entry that opens the dedicated docs site |

## Role Model

- `admin`: system and user administration plus research operations
- `researcher`: study design, ownership, and evidence workflows
- `operator`: active execution and operational views
- `viewer`: read-only visibility where permitted

## Enforcement Model

- route guards run in server-side loaders
- auth state is resolved through bootstrap plus token-based identity lookup
- role checks apply before rendering or mutation
- client-side visibility is only a convenience layer on top of server enforcement

## Important UX Implication

Design and implementation should assume live state can change between page render and action submission. The UI must handle stale or conflicting operational state gracefully.

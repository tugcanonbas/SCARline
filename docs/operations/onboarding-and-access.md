# Onboarding And Access

SCARline bootstraps through explicit onboarding flows before normal sign-in begins.

## Bootstrap Flow

1. `Startup`
2. `Onboarding / System`
3. `Onboarding / Researcher`
4. `Login`

## System Onboarding

The system onboarding form captures the persisted lab configuration used by the platform, including:

- CARLA server path
- data directory
- platform port
- CARLA server port
- transparent overlay behavior

## Researcher Onboarding

The researcher onboarding flow creates the first admin-capable account used for sign-in. This user becomes the initial trusted identity for platform administration and research setup.

## Roles

SCARline uses these roles:

- `admin`
- `researcher`
- `operator`
- `viewer`

Access is enforced in CoreAPI and in SvelteKit server loaders/actions. Hidden controls in the browser are not the real security boundary.

## Operational Guidance

- keep role assignment least-privilege
- use admin surfaces for user management, not ad hoc database edits
- diagnose unexpected redirects or `401/403` states through the auth/me path, route guards, and server-side role checks

# Operations Overview

This section is for people running SCARline in a lab or production-like environment. It is task-oriented rather than architecture-oriented.

## Use This Section For

- bringing the stack up and down safely
- handling bootstrap and account access
- validating study readiness before a participant run
- supervising live sessions
- reviewing evidence and creating exports
- responding to incidents and restoring service in the correct dependency order

## Operating Principles

- keep the persisted study model authoritative even when live dependencies are degraded
- treat simulator, overlay, and sensor health as protocol context, not background noise
- use explicit lifecycle transitions and notes to preserve auditability
- recover dependencies in order instead of restarting everything blindly

## Read In Order

1. [Startup And Shutdown](/operations/startup-and-shutdown)
2. [Onboarding And Access](/operations/onboarding-and-access)
3. [Study Readiness](/operations/study-readiness)
4. [Active Session Operations](/operations/active-session-operations)
5. [Exports And Evidence](/operations/exports-and-evidence)
6. [Incidents And Recovery](/operations/incidents-and-recovery)

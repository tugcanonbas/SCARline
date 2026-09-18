# Operations Overview

This section is for people running SCARline in a lab. It is task-oriented: what to do,
in what order, and what each state means.

## Operating Principles

- **The CLI owns processes.** Nothing in the UI starts or stops a service. When
  something is down, fix it from the terminal.
- **The persisted study model stays authoritative.** A simulator or sensor failure does
  not invalidate study data. Keep the record straight, then recover the dependency.
- **Transitions are explicit and auditable.** Use the lifecycle controls rather than
  abandoning a session; a session left in `running` blocks the study from completing.
- **Degraded hardware is protocol context.** Record it in a note before it becomes a
  question during analysis.
- **Recover in dependency order.** Restarting everything at once hides the cause.

## Use This Section For

<div class="section-grid">
  <div class="section-card">
    <h3>Start And Stop</h3>
    <p>Bringing the stack up and down safely, and reading what <code>status</code> tells you.</p>

[Start and stop](/operations/start-and-stop)

  </div>
  <div class="section-card">
    <h3>Accounts And Access</h3>
    <p>The bootstrap administrator, creating accounts, roles, and study membership.</p>

[Accounts and access](/operations/accounts-and-access)

  </div>
  <div class="section-card">
    <h3>Study Setup</h3>
    <p>Participants, conditions, simulator and sensor configuration, participant layouts.</p>

[Study setup](/operations/study-setup)

  </div>
  <div class="section-card">
    <h3>Study Readiness</h3>
    <p>The nine checks, which ones block, and how to clear each.</p>

[Study readiness](/operations/study-readiness)

  </div>
  <div class="section-card">
    <h3>Running A Session</h3>
    <p>Live supervision: start, advance, pause, trigger, annotate, complete, abort.</p>

[Running a session](/operations/running-a-session)

  </div>
  <div class="section-card">
    <h3>Logs And Exports</h3>
    <p>Reviewing the event stream and producing analysis artifacts.</p>

[Logs and exports](/operations/logs-and-exports)

  </div>
  <div class="section-card">
    <h3>Incidents And Recovery</h3>
    <p>What to do when something fails mid-run, and the order to restore it in.</p>

[Incidents and recovery](/operations/incidents-and-recovery)

  </div>
</div>

## The Daily Loop

```mermaid
flowchart LR
    Start["scarline start"] --> Check["Dashboard + Settings/System Status"]
    Check --> Ready["Study readiness green"]
    Ready --> Run["Active Study: run sessions"]
    Run --> Review["Session Logs"]
    Review --> Export["Exports"]
    Export --> Stop["scarline stop"]
```

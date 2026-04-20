# Getting Started

SCARline is easiest to learn in two passes: first understand the platform model, then follow the path that matches your immediate job.

## Mental Model

- The **Admin Panel** is where researchers, operators, and admins work.
- **CoreAPI** is the authority for persisted domain state, auth, exports, and realtime fanout.
- **RabbitMQ** carries commands and events between backend components.
- **Sim-Bridge** coordinates simulator adapters such as CARLA and the mock simulator.
- **Overlay Web** and **Desktop Overlay** render participant-facing widgets.
- **Python clients** handle simulator-side and sensor-side runtime integration.

## Choose A Starting Path

<div class="section-grid">
  <div class="section-card">
    <h3>Run The Platform</h3>
    <p>Use this if you need to bring up the stack, sign in, create the first study, and supervise sessions.</p>
    <p><a href="/getting-started/first-study">Run your first study</a></p>
  </div>
  <div class="section-card">
    <h3>Build Locally</h3>
    <p>Use this if you need to install dependencies, start the runtime in the right mode, and validate code changes.</p>
    <p><a href="/getting-started/local-development">Run locally</a></p>
  </div>
  <div class="section-card">
    <h3>Troubleshoot Fast</h3>
    <p>Use this if the stack is unhealthy, auth fails, realtime stalls, or the overlay is not behaving as expected.</p>
    <p><a href="/getting-started/troubleshooting">Open troubleshooting entry points</a></p>
  </div>
</div>

## Read Next

- [Platform Overview](/platform/)
- [Architecture](/platform/architecture)
- [Operations Overview](/operations/)
- [Reference Overview](/reference/)

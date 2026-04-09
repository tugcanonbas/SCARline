# SCARline Bootstrap Workspace

This repository contains the milestone-1 bootstrap for SCARline:

- `apps/admin-panel`: SvelteKit milestone-1 operator and researcher UI
- `apps/overlay-web`: browser-based widget renderer
- `apps/desktop-overlay`: Electron transparent overlay shell
- `services/core-api`: Fastify control plane, RabbitMQ bridge, and WebSocket server
- `services/sim-bridge`: simulator adapter broker and RabbitMQ simulator command consumer
- `packages/contracts`: shared Zod schemas and constants
- `python/io-client`: sensor host with Logitech G29 and USB camera scaffolding
- `python/mock-simulator`: mock simulator adapter for macOS and CI-style development
- `python/carla-client`: CARLA simulator adapter scaffold
- `infra`: Docker, Nginx, PostgreSQL, RabbitMQ, and bootstrap scripts
- `widgets`: minimal milestone-1 widget catalogue

Use the root `scarline` script to start the platform once dependencies are installed.

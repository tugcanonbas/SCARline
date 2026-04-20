---
name: "coreapi-backend"
description: "Rules for developing endpoints and handling state in the Fastify-based SCARline CoreAPI, including overlay display/window control, widget layouts, and Fastify/Zod validation."
license: "Apache-2.0"
---

# SCARline CoreAPI Backend Skill

The CoreAPI is the central control plane of the SCARline platform. It bridges the RabbitMQ event bus to the SvelteKit frontend and Overlay Engine via WebSockets.

## 1. Technology Stack

- **Framework**: `Fastify` (Node.js with TypeScript).
- **Validation**: `Zod`.
- **Database**: `pg` (node-postgres).
- **Messaging**: `amqplib`.
- **WebSockets**: `@fastify/websocket`.

## 2. API Endpoints and Validation

Every REST API endpoint must define full Zod validation schemas for the `body`, `querystring`, `params`, and `headers` to utilize Fastify's native validation integration.

```typescript
// Strict rule: Zod schemas are required for all inputs
const CreateStudySchema = z.object({
  name: z.string().min(1),
  carlaConfigurationId: z.string().uuid()
});

fastify.post('/api/studies', {
  schema: {
    body: CreateStudySchema
  }
}, async (request, reply) => {
  // Implementation
});
```

## 3. WebSocket Integration

The CoreAPI powers real-time dashboards and the Overlay Engine.

- You must use `@fastify/websocket`.
- **Authentication**: WebSocket endpoints must parse JWT tokens exclusively via the query parameter (`?token=<jwt>`). Headers cannot be reliably set by standard browser WebSocket APIs.

```typescript
fastify.get('/ws', { websocket: true }, (connection, req) => {
    const token = req.query.token;
    // ... validate and register connection
});
```

## 4. State Management Principle

The CoreAPI holds the authoritative state machine for a Session (Study Run). However, it must **never** modify the state directly and silently. It must publish a command to RabbitMQ (e.g., `study.session.start`), listen for its own completion event, update the PostgreSQL database, and then broadcast the new state via WebSocket.

## 5. Database Interaction

- Do not use heavier ORMs like Prisma or TypeORM. SCARline uses raw SQL with `pg` and connection pooling for performance.
- Utilize PostgreSQL `JSONB` columns for variable data (like widget configs or sensor telemetry payload dumps) rather than heavily normalized relational tables for high-frequency logs.

## 6. Overlay And Widget Layout Control

CoreAPI owns the API boundary for overlay configuration; Admin Panel and overlay-web must not call the Electron control port directly except as an explicit UI fallback.

- Expose and maintain `GET /api/system/overlay/displays` as the normalized display topology endpoint.
- Proxy overlay lifecycle through the Process Manager: `/api/system/overlay/configure`, `/api/system/overlay/windows/open`, `/api/system/overlay/windows/update`, `/api/system/overlay/windows/close`, and `/api/system/overlay/reload`.
- Use Electron device-independent pixels for overlay window specs.
- Keep `view_layouts.target_display` as a layout-level fallback/default only.
- Preserve per-widget `targetDisplay` in `view_layouts.layout_config.widgets[]` and use it when launching or updating each widget window.
- Convert saved relative bounds to absolute virtual-desktop bounds only at launch time: `display.bounds.x + widget.x`, `display.bounds.y + widget.y`.
- Convert live absolute browser/Electron window updates back to display-relative coordinates before persisting.
- `/api/widgets/catalogue` must include normalized `ui` values from real `widget.json` files so Participant View can use preferred/minimum sizes.

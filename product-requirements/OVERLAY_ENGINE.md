# Overlay Engine – Widget Rendering Engine

> **Parent Document**: [PRD.md](./PRD.md)  
> **Related**: [WIDGETS.md](./WIDGETS.md) · [WIDGET_CATALOGUE.md](./WIDGET_CATALOGUE.md) · [CORE_API.md](./CORE_API.md) · [PROCESS_MANAGER.md](./PROCESS_MANAGER.md)

---

## 1. Overview

The Overlay Engine is the **widget rendering engine** that displays widgets to study participants. It supports two rendering modes to accommodate different deployment scenarios.

### Two Rendering Modes

| Mode | Technology | Use Case | Managed By |
|------|-----------|----------|-----------|
| **Web Mode** | HTML served via [Docker](https://www.docker.com) container | Any device on the network; development; additional participant screens | Docker |
| **Desktop Transparent Mode** | [Electron](https://www.electronjs.org) transparent BrowserWindows | Main simulator device — widgets overlay the simulator window | Process Manager (OS-level) |

```mermaid
flowchart TB
    API["CoreAPI\n(WebSocket)"] --> OE_W["Overlay Engine\n(Web Mode - Docker)"]
    API --> OE_T["Overlay Engine\n(Transparent Mode - Electron)"]
    
    OE_W --> D2["Operator / Participant Browser"]
    OE_T --> D1["Simulator Display\n(Transparent Windows)"]
```

---

## 2. Web Mode

### Purpose

Renders widgets in a standard browser window with minimal window controls. Accessible from any device on the local network.

### Access

URL: `scarline:{port}/overlay/[layoutId]`

### Technology

| Component | Value |
|-----------|-------|
| **Served by** | Static file server (Docker container) |
| **Connection** | WebSocket to CoreAPI (`scarline:{port}/ws`) |
| **Widget loading** | Dynamic HTML injection from widget catalogue |
| **Styling** | [TailwindCSS v4](https://tailwindcss.com) |

### Behavior

1. User navigates to `scarline:{port}/overlay/[layoutId]`
2. Overlay Engine fetches the layout configuration from CoreAPI
3. For each widget instance in the layout:
   - Load the widget's `index.html` from the catalogue
   - Position within the defined zone/area
   - Subscribe to relevant WebSocket channels for data bindings
4. Real-time binding updates are applied as WebSocket messages arrive
5. Widget trigger events show/hide/highlight widgets dynamically

### UI Chrome

Minimal window chrome in web mode:
- Small toolbar at the top (collapsible):
  - Connected session indicator
  - Layout name
  - Fullscreen toggle
  - Exit button
- No browser navigation controls when in fullscreen
- Black background behind widget areas

---

## 3. Desktop Transparent Mode

### Purpose

Creates **transparent, always-on-top Electron windows** positioned over the simulator window on the main device. This provides an integrated experience where widgets appear as part of the simulation.

### Technology

| Component | Value |
|-----------|-------|
| **Runtime** | Electron |
| **Window type** | `transparent: true`, `frame: false`, `alwaysOnTop: true` |
| **Connection** | WebSocket to CoreAPI |
| **Widget loading** | Same as web mode — HTML injection |
| **Managed by** | Process Manager (OS-level) |

### Window Management

Each widget zone or individual widget gets its own transparent Electron BrowserWindow:

```javascript
const widgetWindow = new BrowserWindow({
  width: zone.width,
  height: zone.height,
  x: zone.x,
  y: zone.y,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  focusable: false,       // Don't steal focus from simulator
  skipTaskbar: true,       // Don't show in taskbar
  resizable: false,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true
  }
});
```

### Transparency Behavior

- Window background is fully transparent
- Only widget content is visible to the participant
- Click-through is enabled for transparent areas (widgets don't block simulator interaction)
- Widgets with interactive elements (buttons, inputs) can capture focus when needed

### Multi-Screen Support

- Transparent windows can be positioned on any connected display
- The layout configuration specifies target display index
- Widgets can span across displays if configured

---

## 4. Widget Loading Lifecycle

Both modes follow the same widget loading lifecycle:

```mermaid
sequenceDiagram
    participant OE as Overlay Engine
    participant API as CoreAPI
    participant WS as WebSocket

    OE->>API: GET /api/studies/{studyId}/layouts/{layoutId}
    API-->>OE: Layout configuration (zones, widget instances)
    
    loop For each widget instance
        OE->>OE: Load widget HTML from catalogue
        OE->>OE: Inject into zone/window
        OE->>WS: Subscribe to widget bindings channel
    end
    
    OE->>WS: Subscribe to "widget.updates"
    
    loop During active session
        WS-->>OE: Binding data updates
        OE->>OE: Update widget DOM with new data
        WS-->>OE: Widget trigger events
        OE->>OE: Show/hide/highlight widgets
    end
```

---

## 5. Data Binding Model

Widgets receive data through a standardized binding interface. The Overlay Engine acts as the intermediary between CoreAPI WebSocket data and individual widget instances.

### Binding Resolution

1. Each widget instance has a `bindings_config` from the database
2. The Overlay Engine subscribes to relevant WebSocket channels
3. When data arrives, it maps values to widget bindings
4. Updated binding values are passed to the widget via a JavaScript API

### Widget JavaScript API

Each widget has access to a global `SCARline` API injected by the Overlay Engine:

```javascript
// Available in every widget's context
SCARline.onBinding('vehicle.speed', (value) => {
  document.getElementById('speed-display').textContent = value;
});

SCARline.onBinding('vehicle.speedLimit', (value) => {
  document.getElementById('limit-display').textContent = value;
});

SCARline.onTrigger((event) => {
  // Handle manual/automatic trigger
  console.log(event.triggerType, event.payload);
});

SCARline.onStateChange((state) => {
  // 'visible', 'hidden', 'highlighted'
  document.body.className = state;
});

// Report widget is ready
SCARline.ready();
```

---

### Absolute Positioning Model

Starting in v1.1, the Overlay Engine moved from a zone-relative layout to a **high-precision absolute positioning model**. This allows researchers to place widgets anywhere on a virtual 1920×1080 canvas.

- **Storage**: Coordinates (`x`, `y`) and dimensions (`width`, `height`) are stored per widget instance in the `widget_instances` table.
- **Scaling**: The Admin Panel uses a scaled preview, but all coordinates are persisted in "logical pixels" relative to a 1080p resolution. The Overlay Engine maps these back to the physical screen size.
- **Transparency**: A layout-level `isTransparent` flag determines if the container window should have a solid background (standard web mode) or a transparent background (Electron overlay mode).

### Updated Layout Config

```json
{
  "isTransparent": true,
  "zones": [
    { "id": "primary", "x": 0, "y": 0, "width": 1920, "height": 1080, "display": 0 }
  ],
  "widgets": [
    {
      "id": "uuid-1",
      "widgetId": "speedometer",
      "zoneId": "primary",
      "x": 40,
      "y": 40,
      "width": 200,
      "height": 200
    }
  ]
}
```

### Widget Sizing

Widgets are sized based on their intended design dimensions rather than just a zone container:

- **Persisted Width/Height**: The exact dimensions set by the researcher in the Admin Panel editor.
- **Responsive Handling**: Widgets within the `<iframe>` should ideally use `w-full h-full` to adapt to the container provided by the Overlay Engine.

---

## 7. Session Integration

### Session Start

When an active session starts:
1. Overlay Engine receives `session.started` event via WebSocket
2. Loads the participant view layout for the active study
3. Applies condition-specific widget overrides (hidden widgets, trigger rules)
4. Begins rendering widgets and accepting telemetry data

### Session Pause

When a session is paused:
- Widgets freeze with last-known data
- A "Session Paused" overlay may be shown
- Data binding updates stop

### Session End

When a session completes or is cancelled:
- All widgets transition to idle state
- Data bindings disconnect
- Widgets display completion state or are hidden

---

## 8. Condition-Based Widget Control

Study conditions can modify widget behavior:

| Override | Effect |
|----------|--------|
| `hidden_widgets: ["music", "calendar"]` | These widgets are not rendered |
| `trigger_rules` | Additional trigger rules are applied dynamically |
| Widget binding overrides | Specific binding values can be overridden by condition |

The Overlay Engine applies these overrides at session start based on the active condition.

---

## 9. Error Handling

| Error | Behavior |
|-------|----------|
| WebSocket disconnection | Show reconnection indicator, attempt reconnect with backoff |
| Widget fails to load | Show error state in widget's zone, log error |
| Invalid binding data | Ignore malformed data, keep last valid state |
| Electron window crash | Process Manager detects and restarts transparent mode |

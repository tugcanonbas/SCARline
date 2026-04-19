# Admin Panel – Web UI Specification

> **Parent Document**: [PRD.md](./PRD.md)  
> **Related**: [CORE_API.md](./CORE_API.md) · [WIDGETS.md](./WIDGETS.md) · [OVERLAY_ENGINE.md](./OVERLAY_ENGINE.md)

---

## 1. Overview

The Admin Panel is the **primary interface** for researchers, lab admins, and study operators. It is a web-based application accessible from any device on the local network, including tablets and laptops.

### Technology

| Component | Technology |
|-----------|-----------|
| **Framework** | [SvelteKit](https://svelte.dev/docs/kit) |
| **Language** | [TypeScript](https://www.typescriptlang.org) |
| **Styling** | [TailwindCSS v4](https://tailwindcss.com) |
| **State Management** | Svelte stores |
| **API Client** | Fetch API with typed endpoints |
| **Real-Time** | WebSocket subscription for live data |
| **Icons** | [Lucide Icons](https://lucide.dev) |

### Design Principles

| Principle | Description |
|-----------|-------------|
| **Desktop-first** | Optimized for desktop browsers, functional on tablets |
| **Dark mode** | Dark theme as the primary design — lab environments benefit from reduced glare |
| **Information density** | Researchers need to see data, not whitespace |
| **Real-time feedback** | Active sessions show live data with no manual refresh |
| **Keyboard accessible** | Critical operations accessible via keyboard shortcuts |

---

## 2. Route Structure

```
/                                           → Redirect to /dashboard
/startup                                    → System startup screen
/onboarding/system                          → Onboarding Step 1: System configuration
/onboarding/researcher                      → Onboarding Step 2: First researcher
/dashboard                                  → Dashboard
/user-studies                               → Study list
/user-studies/new                           → Create new study
/user-studies/[id]/overview                 → Study overview
/user-studies/[id]/participants             → Participant management
/user-studies/[id]/sessions                 → Session list and controls
/user-studies/[id]/conditions               → Condition management
/user-studies/[id]/carla-config             → CARLA configuration
/user-studies/[id]/sensors                  → Sensor configuration (I/O Client)
/user-studies/[id]/participant-view         → Widget layout editor
/user-studies/[id]/active-study             → Active study controls (operator view)
/session-logs                               → Session log browser
/session-logs/[id]                          → Single session detail
/researchers                                → Researcher list
/researchers/new                            → Create researcher
/researchers/[id]                           → Researcher detail
/settings/system                            → System settings
/settings/devices                           → Device management
/settings/components                        → Component health
/settings/users                             → User management (admin only)
/documentation                              → Embedded documentation
```

---

## 3. Screen Specifications

### 3.1 Startup Screen (`/startup`)

**Purpose**: Displayed when the platform is booting. Shows component initialization progress.

**Behavior**:
- Polls `GET /api/health` until all components report healthy
- Shows individual component status with icons (loading, healthy, error)
- Automatically redirects to `/dashboard` when ready, or to `/onboarding/system` if first run

**UI Elements**:
- SCARline logo (centered)
- Platform version
- Component status list:
  - PostgreSQL Database
  - RabbitMQ Message Bus
  - CoreAPI
  - Sim-Bridge
  - CARLA Server (if configured)
  - I/O Client (if configured)
- Progress bar or spinner
- Error detail expandable sections on failure

---

### 3.2 Onboarding: System Configuration (`/onboarding/system`)

**Purpose**: First-time setup. Collects system paths and port configuration.

**API**: `POST /api/onboarding/system`

**Form Fields**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| CARLA Server Path | File path input with browse button | — | Path to CARLA binary on host |
| Data Storage Directory | File path input | `/data/scarline` | Where exports and large data are stored |
| Platform Port | Number input | `80` | Host port for the platform |
| CARLA Server Port | Number input | `2000` | CARLA Server RPC port |

**Behavior**:
- Validates CARLA path existence (if provided)
- Validates port availability
- "Skip CARLA" option for non-simulation setups
- Saves configuration and proceeds to Step 2

---

### 3.3 Onboarding: First Researcher (`/onboarding/researcher`)

**Purpose**: Creates the first researcher profile and admin user account.

**API**: `POST /api/onboarding/researcher`

**Form Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Full Name | Text | Yes | Researcher name |
| Email | Email | No | Contact email |
| Institution | Text | No | University / lab |
| Role | Text | No | Research role |
| Username | Text | Yes | Admin login username |
| Password | Password | Yes | Admin login password |

**Behavior**:
- Creates a researcher profile
- Creates an admin user account linked to the researcher
- Marks onboarding as complete
- Redirects to `/dashboard`

---

### 3.4 Dashboard (`/dashboard`)

**Purpose**: Central hub showing platform overview and quick actions.

**API**: `GET /api/dashboard`  
**WebSocket**: Subscribes to `system.health` and `session.events`

**Layout Sections**:

#### Quick Actions Bar
Row of action buttons:
- "New Study" → navigates to `/user-studies/new`
- "Start Session" → navigates to active study's session page (if study is active)
- "Export Data" → opens export dialog
- "Documentation" → navigates to `/documentation`

#### Active Studies Panel
- Cards for each study with `status: active`
- Each card shows: study name, participant count, session count, last session date
- Click → navigates to study overview

#### Recent Sessions Feed
- Chronological list of recent session actions (started, completed, cancelled)
- Shows: session name, study name, participant, timestamp, status badge
- Click → navigates to session log

#### Component Health Panel
- Grid of component status cards
- Each card: component name, status icon (green/yellow/red), last check time
- Components: Database, RabbitMQ, Sim-Bridge, CARLA Server, I/O Client, Overlay Engine
- Red indicators expand to show error details

#### Platform Statistics
- Total studies, total sessions, total participants, total events collected

---

### 3.5 User Studies List (`/user-studies`)

**Purpose**: View and manage all user studies.

**API**: `GET /api/studies`

**UI Elements**:
- Header with "New Study" button
- Filter bar: status (draft, active, completed, archived), researcher, search
- Study table/card list:
  - Name, status badge, participant count, session count, created by, created date
  - Status actions: activate, archive
  - Click → navigates to study overview

---

### 3.6 Create Study (`/user-studies/new`)

**Purpose**: Create a new study with basic metadata.

**API**: `POST /api/studies`

**Form Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Study Name | Text | Yes | Name of the study |
| Description | Textarea | No | Study description |
| Assigned Researchers | Multi-select | No | Researchers on this study |

**Behavior**: Creates study in `draft` status and redirects to study overview page.

---

### 3.7 Study Overview (`/user-studies/[id]/overview`)

**Purpose**: Study details and navigation hub.

**API**: `GET /api/studies/:id`

**Layout**:
- **Header**: Study name, status badge, edit button, status change dropdown (draft → active → completed → archived)
- **Tab Navigation**: Links to all study sub-pages (overview, participants, sessions, conditions, CARLA config, sensors, participant view, active study)
- **Overview Content**:
  - Description
  - Assigned researchers
  - Statistics: conditions count, participants count, sessions count
  - Creation/update timestamps

---

### 3.8 Participants (`/user-studies/[id]/participants`)

**Purpose**: Manage study participants and condition assignments.

**APIs**: `GET/POST/PUT/DELETE /api/studies/:studyId/participants`

**UI Elements**:
- "Add Participant" button
- Participant table:
  - Code (P-001, P-002...), assigned condition, session count, notes
  - Edit, delete actions
  - Condition assignment dropdown per participant
- Inline editing for quick updates

---

### 3.9 Sessions/Runs (`/user-studies/[id]/sessions`)

**Purpose**: Create and manage study sessions (runs). This is where researchers design individual experiment runs.

**APIs**: `GET/POST /api/studies/:studyId/sessions`, session lifecycle endpoints

**UI Elements**:
- "New Session" button → opens creation form (participant selection, condition, name)
- Session table:
  - Name, participant code, condition, status badge, started at, duration
  - Lifecycle action buttons per session (start, pause, resume, complete, cancel)
- Session status filters (created, running, paused, completed, cancelled)

**Real-time**: WebSocket subscription for live session status updates.

---

### 3.10 Conditions (`/user-studies/[id]/conditions`)

**Purpose**: Design study conditions — named configuration variants.

**APIs**: `GET/POST/PUT/DELETE /api/studies/:studyId/conditions`

**UI Elements**:
- "Add Condition" button
- Condition cards/list (draggable for reordering):
  - Name, description
  - **CARLA Overrides section**: collapsible panel showing weather, traffic, speed limits, etc.
  - **Widget Overrides section**: which widgets to hide/show, trigger rules per widget
  - Edit, duplicate, delete actions

**Condition Editor Form**:
| Field | Type | Description |
|-------|------|-------------|
| Name | Text | Condition name (e.g., "High Traffic - Rain") |
| Description | Textarea | Description of this condition variant |
| CARLA Weather | Preset dropdown + custom fields | Weather configuration for this condition |
| CARLA Traffic Density | Slider (0–100) | NPC vehicle density |
| Pedestrian Density | Slider (0–100) | Pedestrian density |
| Speed Limit Override | Number input | Override default speed limit |
| Hidden Widgets | Multi-select from widget catalogue | Widgets to hide in this condition |
| Trigger Rules | Rule builder | Configurable trigger rules for this condition |

---

### 3.11 CARLA Configuration (`/user-studies/[id]/carla-config`)

**Purpose**: Configure the CARLA simulator settings for this study's default setup.

**APIs**: `GET/PUT /api/studies/:studyId/carla-config`, preset endpoints

**UI Sections**:

#### Map Selection
- Visual grid of available CARLA maps with thumbnails and descriptions
- Town01 through Town12 (or custom imported maps)
- Selected map highlighted

#### Weather Configuration
- Preset selector with visual previews (ClearNoon, CloudyNoon, WetNoon, HardRainNoon, ClearSunset, etc.)
- "Advanced" toggle reveals individual parameter sliders:
  - Cloudiness (0–100)
  - Precipitation (0–100)
  - Precipitation Deposits (0–100)
  - Wind Intensity (0–100)
  - Fog Density (0–100)
  - Fog Distance (meters)
  - Sun Azimuth (0–360°)
  - Sun Altitude (-90–90°)
  - Wetness (0–100)

#### Ego Vehicle
- Blueprint selector with vehicle previews
- Default: `vehicle.lincoln.mkz_2020`
- Role name: always `hero`

#### Sensor Setup
- Sensor list with add/remove/configure
- Each sensor entry:
  - Type selector: RGB Camera, Depth Camera, Semantic Segmentation, LiDAR, Semantic LiDAR, Radar, GNSS, IMU, Collision Detector, Lane Invasion, Obstacle Detector
  - Attribute configuration form (varies by sensor type)
  - Transform editor (x, y, z, pitch, yaw, roll)
  - Attachment: ego vehicle (default)

#### Traffic Configuration
- NPC vehicle count slider
- Pedestrian count slider
- Pedestrian cross factor slider (0–1)
- Traffic Manager settings:
  - Global speed difference
  - Distance to leading vehicle
  - Lane change behavior

#### Simulation Settings
- Mode: Synchronous (default, recommended) / Asynchronous
- Fixed delta seconds: 0.05 (default)
- No rendering mode toggle
- Physics substepping configuration

#### Spectator Camera
- Mode: Follow ego (default) / Fixed position / Free
- Follow offset (x, y, z)

#### Recording
- Auto-record sessions toggle
- Record with additional data toggle

---

### 3.12 Sensor Configuration – I/O Client (`/user-studies/[id]/sensors`)

**Purpose**: Configure physical sensors for data collection via the I/O Client.

**APIs**: `GET/PUT /api/studies/:studyId/sensor-config`, `GET /api/sensors/drivers`

**UI Elements**:
- Connected sensors status panel (live from I/O Client)
- Sensor configuration list:
  - Add sensor button (type selector: eye tracker, steering wheel, HR monitor, camera, custom)
  - For each sensor:
    - Type
    - Driver selection (populated from available I/O Client drivers)
    - Sample rate
    - Custom metadata fields (JSONB editor)
    - Enable/disable toggle
    - Calibration button (if supported by driver)

---

### 3.13 Participant View Editor (`/user-studies/[id]/participant-view`)

**Purpose**: Visual editor for arranging widgets on participant screens.

**APIs**: `GET/POST/PUT /api/studies/:studyId/layouts`, `GET /api/widgets/catalogue`, `GET /api/system/overlay/displays`, `POST /api/system/overlay/windows/open`, `POST /api/system/overlay/windows/close`

**UI Elements**:
- Display topology strip showing connected screens in their detected relative arrangement
- Display-aware canvas for the selected participant display dimensions
- Widget catalogue panel (sidebar):
  - Grouped by category (Driving, Communication, Health, Study Management, General/Infotainment)
  - Drag-and-drop from catalogue to canvas
  - Search/filter
- Placed widgets on canvas:
  - Draggable and resizable
  - Click to configure bindings and trigger rules
  - Assigned display selector for moving one widget to another connected display
  - Close live widget window button
  - Delete button
- Layout presets (save/load named layouts)
- Launch controls for transparent Electron windows or browser-popup windows
- Close All Widgets control for live overlay windows
- Multi-display support with per-widget `targetDisplay`; changing the selected display filters the canvas to widgets assigned to that display without moving other widgets

---

### 3.14 Active Study Controls (`/user-studies/[id]/active-study`)

**Purpose**: Real-time study control screen for operators. This is the primary screen used during an active study session.

**WebSocket**: Subscribes to `session.events`, `session.telemetry`, `widget.updates`, `sensor.status`

**Layout Sections**:

#### Session Control Bar
- Active session selector (dropdown of running/paused sessions)
- Lifecycle buttons: Start, Pause, Resume, Complete, Cancel
- Session timer (elapsed time)
- Recording indicator

#### Live Telemetry Panel
- Vehicle speed, position, heading
- Throttle/brake/steering inputs
- Current weather conditions

#### Widget Trigger Panel
- List of all widgets in the active layout
- For each widget:
  - Current state (visible/hidden/highlighted)
  - Manual trigger button
  - Quick binding value override fields
  - Preset trigger configurations (saved combinations)

#### Sensor Status Panel
- Connected sensor indicators (green/red)
- Current data rates per sensor
- Eye tracker gaze position overlay (if connected)

#### Session Notes
- Text area for operator notes (auto-saved)
- Timestamped note entries

---

### 3.15 Session Logs (`/session-logs`)

**Purpose**: Browse and inspect session event data.

**API**: `GET /api/session-logs`

**UI Elements**:
- Filter bar: study selector, session selector, event type, modality, time range, search
- Event table (paginated):
  - Timestamp, event type, modality, source, payload preview
  - Click to expand full payload (JSON viewer)
- Export button (filtered events to CSV/JSON)

---

### 3.16 Session Log Detail (`/session-logs/[id]`)

**Purpose**: Detailed view of a single session's events.

**API**: `GET /api/session-logs/:sessionId`

**UI Elements**:
- Session metadata header (participant, condition, duration, event count)
- Timeline visualization (events plotted on a time axis)
- Event stream (chronological list with filters)
- Summary statistics:
  - Total events by type
  - Total events by modality
  - Telemetry charts (speed over time, etc.)

---

### 3.17 Researchers (`/researchers`)

**Purpose**: Manage researcher profiles.

**API**: `GET /api/researchers`

**UI Elements**:
- "New Researcher" button
- Researcher cards/table:
  - Name, institution, role, email, active studies count
  - Click → researcher detail

---

### 3.18 Create Researcher (`/researchers/new`)

**API**: `POST /api/researchers`

**Form Fields**: Name, email, institution, role, phone, notes.

---

### 3.19 Researcher Detail (`/researchers/[id]`)

**API**: `GET /api/researchers/:id`

**UI Elements**:
- Profile information (editable)
- Assigned studies list
- Activity log (sessions participated in or supervised)

---

### 3.20 Settings: System (`/settings/system`)

**Purpose**: View and modify system configuration.

**API**: `GET/PUT /api/system/configuration`

**Form Fields**:
- Same as onboarding system fields (CARLA path, data directory, ports)
- "Restore Defaults" button
- "Restart System" button (triggers Process Manager restart)

---

### 3.21 Settings: Devices (`/settings/devices`)

**Purpose**: Manage connected devices.

**API**: `GET/POST/PUT/DELETE /api/devices`

**UI Elements**:
- Device list with status indicators
- Register new device form (name, type, display configuration)
- Device health monitoring

---

### 3.22 Settings: Components (`/settings/components`)

**Purpose**: Monitor platform component health in detail.

**API**: `GET /api/system/components`

**UI Elements**:
- Component list with detailed status:
  - PostgreSQL: connection status, database size, active connections
  - RabbitMQ: connection status, queue depths, message rates
  - Sim-Bridge: connection status, connected adapters
  - CARLA Server: running status, version, loaded map
  - I/O Client: connection status, connected sensors
  - Overlay Engine: status, active widget count
- Dead letter queue inspector (from RabbitMQ)
- Container resource usage (if available)

---

### 3.23 Settings: User Management (`/settings/users`)

**Purpose**: Admin-only screen for managing platform user accounts.

**API**: `GET/POST/PUT/DELETE /api/users`

**UI Elements**:
- User list: username, display name, roles, active status
- Create user form
- Edit user form (change roles, reset password)
- Deactivate/reactivate user toggle

---

### 3.24 Documentation (`/documentation`)

**Purpose**: Embedded documentation browser for onboarding researchers and developers.

**Content Sections**:
- Architecture Overview
- Getting Started Guide
- Study Design Guide
- Widget Development Guide
- Sensor Integration Guide
- API Reference
- Troubleshooting

**Behavior**: Loads content from the docs container (`scarline:{port}/docs/...`) in an embedded frame or as rendered markdown.

---

## 4. Navigation Structure

### Sidebar Navigation

```
┌─────────────────────────┐
│  SCARline Logo          │
├─────────────────────────┤
│  📊 Dashboard           │
│  🔬 User Studies        │
│  📋 Session Logs        │
│  👤 Researchers         │
│  ⚙️ Settings            │
│    ├── System           │
│    ├── Devices          │
│    ├── Components       │
│    └── Users            │
│  📚 Documentation       │
├─────────────────────────┤
│  User Profile           │
│  Logout                 │
└─────────────────────────┘
```

### Study Sub-Navigation (Tabs)

When inside a study (`/user-studies/[id]/...`), horizontal tabs provide sub-page navigation:

```
Overview | Participants | Sessions | Conditions | CARLA Config | Sensors | Participant View | Active Study
```

---

## 5. Multi-Device Access

The Admin Panel is accessible from any device on the local network:

- **Main Device**: Full access to all features
- **Operator Laptop**: Focused on Active Study Controls for running sessions
- **Tablet**: Responsive layout for core controls (session lifecycle, widget triggers)

### Responsive Behavior

| Screen Size | Layout |
|-------------|--------|
| Desktop (≥1280px) | Full layout with expanded sidebar and multi-column panels |
| Tablet (768–1279px) | Collapsible sidebar, single-column content with tabbed panels |
| Mobile (<768px) | Not officially supported — functional but not optimized |

---

## 6. Role-Based View Filtering

Different user roles see different navigation items and functionality:

| View | Admin | Researcher | Operator | Viewer |
|------|-------|-----------|----------|--------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| User Studies (all) | ✅ | Own studies | Assigned studies | Assigned studies |
| Create Study | ✅ | ✅ | ❌ | ❌ |
| Study Design (conditions, CARLA, sensors, layout) | ✅ | ✅ | ❌ | ❌ |
| Active Study Controls | ✅ | ✅ | ✅ | ❌ |
| Session Logs | ✅ | ✅ | ✅ | ✅ |
| Researchers | ✅ | ✅ | ❌ | ❌ |
| Settings: System | ✅ | ❌ | ❌ | ❌ |
| Settings: Devices | ✅ | ✅ | ❌ | ❌ |
| Settings: Components | ✅ | ✅ | ❌ | ❌ |
| Settings: Users | ✅ | ❌ | ❌ | ❌ |
| Documentation | ✅ | ✅ | ✅ | ✅ |

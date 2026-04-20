# Widget Catalogue – Complete Widget Specifications

> **Parent Document**: [PRD.md](./PRD.md)  
> **Related**: [WIDGETS.md](./WIDGETS.md) · [OVERLAY_ENGINE.md](./OVERLAY_ENGINE.md) · [RABBITMQ_EVENTS_AND_COMMANDS.md](./RABBITMQ_EVENTS_AND_COMMANDS.md)

---

## 1. Overview

This catalogue defines all 24 widgets included in the SCARline platform. Each widget entry specifies its identity, category, data bindings, default sizing, and intended behavior.

For the technical architecture, development guide, and `widget.json` schema, see [WIDGETS.md](./WIDGETS.md).

### Summary by Category

| Category | Count | Widgets |
|----------|-------|---------|
| **Driving** | 2 | speedometer, navigation-prompt |
| **Communication** | 8 | contact, contactlist, incomingcall, activecall, outgoingcall, callended, calldeclined, music |
| **Health / Biometric** | 5 | bp, ecg, hr, resp, spo2 |
| **Study Management** | 5 | study-instruction, session-timeline, operator-controls, operator-notes, sensor-health |
| **General / Infotainment** | 4 | time, calendar, appointments, avatar |
| **Total** | **24** | |

---

## 2. Driving Widgets

### `speedometer`

| Property | Value |
|----------|-------|
| **Name** | Speedometer |
| **Category** | `driving` |
| **Description** | Displays the current vehicle speed and speed limit. Changes visual state when exceeding the limit. |
| **Preferred Size** | 300 × 300 px |
| **Minimum Size** | 200 × 200 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `vehicle.speed` | `number` | km/h | Current vehicle speed |
| `vehicle.speedLimit` | `number` | km/h | Current road speed limit |

**Behavior**: Supports both a radial **gauge** and a **numeric** display mode (configurable per widget instance). Highlight or color change (red) when speed exceeds the limit. Supports `highlight` trigger action for researcher-controlled emphasis.

---

### `navigation-prompt`

| Property | Value |
|----------|-------|
| **Name** | Navigation Prompt |
| **Category** | `driving` |
| **Description** | Displays turn-by-turn navigation instructions with direction arrows and distance to next maneuver. |
| **Preferred Size** | 400 × 200 px |
| **Minimum Size** | 250 × 120 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `navigation.instruction` | `string` | — | Current instruction text (e.g., "Turn right in 200m") |
| `navigation.distance` | `number` | m | Distance to next maneuver |
| `navigation.direction` | `string` | — | Direction: `left`, `right`, `straight`, `u-turn`, `arrive` |
| `navigation.roadName` | `string` | — | Name of the next road |

**Behavior**: Shows navigation card with directional arrow icon, instruction text, and distance. Auto-hides when no active navigation instruction. Supports manual trigger for researcher-injected instructions.

---

## 3. Communication Widgets

### `contact`

| Property | Value |
|----------|-------|
| **Name** | Contact Card |
| **Category** | `communication` |
| **Description** | Displays a single contact's information (name, avatar, phone number). |
| **Preferred Size** | 350 × 120 px |
| **Minimum Size** | 250 × 80 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `contact.name` | `string` | Contact's full name |
| `contact.phone` | `string` | Phone number |
| `contact.avatar` | `string` | Avatar image URL or initial letter |

---

### `contactlist`

| Property | Value |
|----------|-------|
| **Name** | Contact List |
| **Category** | `communication` |
| **Description** | Scrollable list of contacts. Used for browsing and selecting contacts for communication. |
| **Preferred Size** | 350 × 500 px |
| **Minimum Size** | 250 × 300 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `contacts.list` | `array` | Array of contact objects `[{name, phone, avatar}]` |
| `contacts.selectedIndex` | `number` | Currently selected contact index |

---

### `incomingcall`

| Property | Value |
|----------|-------|
| **Name** | Incoming Call |
| **Category** | `communication` |
| **Description** | Incoming call notification with caller info and accept/decline visual. |
| **Preferred Size** | 400 × 300 px |
| **Minimum Size** | 300 × 200 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `call.callerName` | `string` | Caller's name |
| `call.callerPhone` | `string` | Caller's phone number |
| `call.callerAvatar` | `string` | Caller's avatar |
| `call.ringDuration` | `number` | Seconds since ring started |

**Behavior**: Shows pulsating ring animation. Transitions to `activecall` or `calldeclined` based on researcher trigger.

---

### `activecall`

| Property | Value |
|----------|-------|
| **Name** | Active Call |
| **Category** | `communication` |
| **Description** | Active call screen showing caller info and call duration timer. |
| **Preferred Size** | 400 × 300 px |
| **Minimum Size** | 300 × 200 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `call.callerName` | `string` | Caller's name |
| `call.duration` | `number` | Call duration in seconds |
| `call.muted` | `boolean` | Whether the call is muted |

---

### `outgoingcall`

| Property | Value |
|----------|-------|
| **Name** | Outgoing Call |
| **Category** | `communication` |
| **Description** | Outgoing call screen showing callee info and dialing animation. |
| **Preferred Size** | 400 × 300 px |
| **Minimum Size** | 300 × 200 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `call.calleeName` | `string` | Callee's name |
| `call.calleePhone` | `string` | Callee's phone number |
| `call.dialDuration` | `number` | Seconds since dial started |

---

### `callended`

| Property | Value |
|----------|-------|
| **Name** | Call Ended |
| **Category** | `communication` |
| **Description** | Brief notification that the call has ended, showing call summary. |
| **Preferred Size** | 400 × 200 px |
| **Minimum Size** | 300 × 150 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `call.callerName` | `string` | Other party's name |
| `call.totalDuration` | `number` | Total call duration in seconds |
| `call.endReason` | `string` | Reason: `completed`, `dropped`, `timeout` |

**Behavior**: Auto-hides after 5 seconds (configurable via trigger).

---

### `calldeclined`

| Property | Value |
|----------|-------|
| **Name** | Call Declined |
| **Category** | `communication` |
| **Description** | Brief notification that an incoming call was declined. |
| **Preferred Size** | 400 × 150 px |
| **Minimum Size** | 300 × 100 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `call.callerName` | `string` | Declined caller's name |

**Behavior**: Auto-hides after 3 seconds. Intended to be shown after researcher triggers a decline action on `incomingcall`.

---

### `music`

| Property | Value |
|----------|-------|
| **Name** | Music Player |
| **Category** | `communication` |
| **Description** | In-vehicle music player interface showing current track, artist, album art, and playback controls. |
| **Preferred Size** | 400 × 200 px |
| **Minimum Size** | 300 × 120 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `music.trackName` | `string` | Current track title |
| `music.artistName` | `string` | Artist name |
| `music.albumArt` | `string` | Album cover image URL |
| `music.isPlaying` | `boolean` | Playback state |
| `music.progress` | `number` | Playback progress (0–1) |
| `music.duration` | `number` | Total track duration in seconds |

---

## 4. Health / Biometric Widgets

### `hr`

| Property | Value |
|----------|-------|
| **Name** | Heart Rate |
| **Category** | `health` |
| **Description** | Displays real-time heart rate from the I/O Client HR sensor. |
| **Preferred Size** | 250 × 250 px |
| **Minimum Size** | 150 × 150 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `health.heartrate.bpm` | `number` | bpm | Current heart rate |
| `health.heartrate.status` | `string` | — | Status: `normal`, `elevated`, `high` |

**Behavior**: Animated heart icon pulsing at the current heart rate. Color changes based on status thresholds.

---

### `ecg`

| Property | Value |
|----------|-------|
| **Name** | ECG Monitor |
| **Category** | `health` |
| **Description** | Real-time ECG waveform display from the I/O Client ECG sensor. |
| **Preferred Size** | 500 × 200 px |
| **Minimum Size** | 300 × 120 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `health.ecg.samples` | `array` | Array of voltage samples |
| `health.ecg.sampleRate` | `number` | Samples per second |
| `health.ecg.leadType` | `string` | Lead type (e.g., `single`) |

**Behavior**: Scrolling waveform display rendering ECG samples in real-time. Green line on dark background, classic ECG monitor visual style.

---

### `bp`

| Property | Value |
|----------|-------|
| **Name** | Blood Pressure |
| **Category** | `health` |
| **Description** | Displays blood pressure readings (systolic/diastolic). |
| **Preferred Size** | 250 × 200 px |
| **Minimum Size** | 180 × 150 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `health.bp.systolic` | `number` | mmHg | Systolic pressure |
| `health.bp.diastolic` | `number` | mmHg | Diastolic pressure |
| `health.bp.status` | `string` | — | Status: `normal`, `pre-hypertension`, `hypertension` |

---

### `resp`

| Property | Value |
|----------|-------|
| **Name** | Respiratory Rate |
| **Category** | `health` |
| **Description** | Displays real-time respiratory rate. |
| **Preferred Size** | 250 × 200 px |
| **Minimum Size** | 150 × 120 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `health.resp.breathRate` | `number` | breaths/min | Current respiratory rate |
| `health.resp.amplitude` | `number` | — | Breathing amplitude (0–1) |

**Behavior**: Animated breathing wave visualization synced to the respiratory rate. The wave expands and contracts to visually represent breathing rhythm.

---

### `spo2`

| Property | Value |
|----------|-------|
| **Name** | Oxygen Saturation (SpO2) |
| **Category** | `health` |
| **Description** | Displays blood oxygen saturation percentage. |
| **Preferred Size** | 200 × 200 px |
| **Minimum Size** | 150 × 150 px |

**Bindings**:

| Key | Type | Unit | Description |
|-----|------|------|-------------|
| `health.spo2.percentage` | `number` | % | Oxygen saturation percentage |
| `health.spo2.status` | `string` | — | Status: `normal` (≥95%), `low` (90–94%), `critical` (<90%) |

---

## 5. Study Management Widgets

### `study-instruction`

| Property | Value |
|----------|-------|
| **Name** | Study Instruction |
| **Category** | `study` |
| **Description** | Displays researcher-defined instructions to the participant. Commonly used for scenario prompts and task descriptions. |
| **Preferred Size** | 500 × 300 px |
| **Minimum Size** | 300 × 150 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `study.instruction.title` | `string` | Instruction title |
| `study.instruction.body` | `string` | Instruction body text (supports basic markdown) |
| `study.instruction.step` | `number` | Current step number (optional) |
| `study.instruction.totalSteps` | `number` | Total steps (optional) |
| `study.instruction.priority` | `string` | Priority: `info`, `warning`, `critical` |

**Behavior**: Typically triggered manually by the researcher at specific moments during the study. Supports step progression for multi-step instructions. Color-coded priority indicator.

---

### `session-timeline`

| Property | Value |
|----------|-------|
| **Name** | Session Timeline |
| **Category** | `study` |
| **Description** | Displays session progress to the participant — elapsed time, current phase, and remaining time (if known). |
| **Preferred Size** | 400 × 80 px |
| **Minimum Size** | 250 × 60 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `session.elapsedTime` | `number` | Seconds since session started |
| `session.totalDuration` | `number` | Expected total duration (0 if unknown) |
| `session.phase` | `string` | Current study phase name (optional) |
| `session.progress` | `number` | Progress percentage (0–100, optional) |

**Behavior**: Displays both a **progress bar** and a **timer**. Shows elapsed time as `MM:SS`. If total duration is known, shows remaining time and a progress bar fill.

---

### `operator-controls`

| Property | Value |
|----------|-------|
| **Name** | Operator Controls |
| **Category** | `study` |
| **Description** | Displays primary researcher/operator runtime actions during an active session. |
| **Preferred Size** | 316 × 129 px |
| **Minimum Size** | 316 × 129 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `controls.runtime_state` | `string` | Current runtime state label |
| `controls.primary_label` | `string` | Primary operator action label |
| `controls.secondary_label` | `string` | Secondary operator action label |
| `controls.tertiary_label` | `string` | Tertiary operator action label |

**Behavior**: Shows active-study control labels inside the overlay layout. User interactions must be routed through the injected `SCARline` widget API; the widget must not call backend APIs directly.

---

### `operator-notes`

| Property | Value |
|----------|-------|
| **Name** | Operator Notes |
| **Category** | `study` |
| **Description** | Displays live researcher notes, reminders, or participant observations during a session. |
| **Preferred Size** | 316 × 129 px |
| **Minimum Size** | 316 × 129 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `notes.title` | `string` | Notes card title |
| `notes.body` | `string` | Primary note content |
| `notes.footer` | `string` | Secondary note metadata |

**Behavior**: Presents operator-authored note content in the overlay. Notes originate from CoreAPI/Admin Panel state and are delivered through standard widget binding updates.

---

### `sensor-health`

| Property | Value |
|----------|-------|
| **Name** | Sensor Health |
| **Category** | `study` |
| **Description** | Displays current runtime status of attached sensors for operator awareness. |
| **Preferred Size** | 316 × 197 px |
| **Minimum Size** | 316 × 197 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `sensor.streaming_label` | `string` | Streaming status summary |
| `sensor.issue_label` | `string` | Issue summary label |
| `sensor.summary_1` | `string` | First sensor detail line |
| `sensor.summary_2` | `string` | Second sensor detail line |
| `sensor.summary_3` | `string` | Third sensor detail line |

**Behavior**: Summarizes healthy and degraded sensor states using binding data from CoreAPI's I/O client status stream.

---

## 6. General / Infotainment Widgets

### `time`

| Property | Value |
|----------|-------|
| **Name** | Clock |
| **Category** | `general` |
| **Description** | Displays the current time in both **digital** and **analog** formats (configurable per widget instance). Simulates an in-vehicle clock. |
| **Preferred Size** | 200 × 80 px |
| **Minimum Size** | 120 × 50 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `time.current` | `string` | Current time string (HH:MM format) |
| `time.format` | `string` | Format: `12h` or `24h` |

**Behavior**: Standalone clock display. Can use live system time or researcher-controlled simulated time.

---

### `calendar`

| Property | Value |
|----------|-------|
| **Name** | Calendar |
| **Category** | `general` |
| **Description** | Displays a mini calendar view showing the current simulated date and upcoming events. |
| **Preferred Size** | 350 × 400 px |
| **Minimum Size** | 250 × 300 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `calendar.currentDate` | `string` | Current date (ISO format) |
| `calendar.events` | `array` | Array of event objects `[{title, time, date}]` |

**Behavior**: Monthly mini-calendar grid with highlighted dates that have events. Today's date is emphasized.

---

### `appointments`

| Property | Value |
|----------|-------|
| **Name** | Appointments |
| **Category** | `general` |
| **Description** | Displays an upcoming appointments list, simulating an in-vehicle agenda. |
| **Preferred Size** | 350 × 300 px |
| **Minimum Size** | 250 × 200 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `appointments.list` | `array` | Array of appointment objects `[{title, time, location, duration}]` |
| `appointments.nextIndex` | `number` | Index of the next upcoming appointment |

**Behavior**: Scrollable list of appointments. The next upcoming appointment is highlighted. Shows time, title, and location for each entry.

---

### `avatar`

| Property | Value |
|----------|-------|
| **Name** | User Avatar |
| **Category** | `general` |
| **Description** | Displays the current user's avatar/profile image. Used as a visual identity element in infotainment layouts. |
| **Preferred Size** | 100 × 100 px |
| **Minimum Size** | 60 × 60 px |

**Bindings**:

| Key | Type | Description |
|-----|------|-------------|
| `user.name` | `string` | Display name |
| `user.avatar` | `string` | Avatar image URL or initials |

**Behavior**: Circular avatar display. Falls back to initials if no image URL is provided.

---

## 7. Widget Cross-Reference: Data Sources

| Widget | Primary Data Source | Real-Time? |
|--------|-------------------|-----------|
| speedometer | CARLA Client → Sim-Bridge → CoreAPI | Yes |
| navigation-prompt | Manual trigger / CoreAPI | Trigger-based |
| contact, contactlist | Manual trigger / CoreAPI | Trigger-based |
| incomingcall, activecall, outgoingcall, callended, calldeclined | Manual trigger / CoreAPI | Trigger-based |
| music | Manual trigger / CoreAPI | Trigger-based |
| hr | I/O Client (HR sensor) → RabbitMQ → CoreAPI | Yes |
| ecg | I/O Client (ECG sensor) → RabbitMQ → CoreAPI | Yes |
| bp | I/O Client (BP sensor) → RabbitMQ → CoreAPI | Periodic |
| resp | I/O Client (Resp sensor) → RabbitMQ → CoreAPI | Yes |
| spo2 | I/O Client (SpO2 sensor) → RabbitMQ → CoreAPI | Yes |
| study-instruction | Manual trigger / CoreAPI | Trigger-based |
| session-timeline | CoreAPI (session metadata) | Yes |
| operator-controls | CoreAPI (active study controls) | Trigger-based |
| operator-notes | CoreAPI/Admin Panel operator notes | Yes |
| sensor-health | I/O Client status → RabbitMQ → CoreAPI | Yes |
| time | System clock / Manual override | Yes |
| calendar, appointments | Manual trigger / CoreAPI | Trigger-based |
| avatar | CoreAPI (participant profile) | Static |

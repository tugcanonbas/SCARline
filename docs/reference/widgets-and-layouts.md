# Widgets And Layouts

This page summarizes the overlay configuration model used by CoreAPI, Overlay Web, and the participant view editor.

## Layout Shape

A layout contains:

- `name`
- `type`
- `targetDisplay`
- `isTransparent`
- `widgets`

Supported layout types:

- `participant`
- `researcher_monitor`

## Widget Instance Shape

Each widget instance carries:

- `id`
- `widgetId`
- `windowMode`
- `targetDisplay`
- `order`
- `x`, `y`, `width`, `height`
- `bindingsConfig`
- `triggerRules`
- `styleOverrides`

Supported window modes:

- `transparent_electron`
- `browser_popup`

## Widget Metadata Requirements

Widget metadata must provide:

- id
- name
- description
- version
- category
- entry
- bindings
- actions or triggers
- sizing metadata

The runtime supports both a legacy array-based metadata form and a modern object-map form, then normalizes both into one usable shape.

## Action And Trigger Notes

- actions describe supported widget behavior
- trigger rules connect runtime conditions to widget actions
- binding updates may be driven manually or by rules
- display targeting and bounds are part of the persisted runtime plan, not only a UI convenience

# Extending Widgets And Layouts

Widgets are static runtime artifacts. Treat the widget system as a catalogue plus configuration model, not as a compiled frontend application.

## Widget Rules

- place widgets under `widgets/components/<widget-id>`
- keep the entry file static
- provide valid `widget.json` metadata
- declare bindings, actions/triggers, and sizing correctly
- respect supported categories and action semantics

## Layout Rules

Layouts are persisted through CoreAPI and must remain compatible with:

- layout type
- transparency mode
- target display
- widget order and bounds
- window mode
- binding configuration
- trigger rule data

## When You Add Or Change A Widget

1. update the widget files
2. confirm metadata validates
3. ensure overlay asset routing still resolves correctly
4. validate the widget in participant view and one runtime mode
5. update docs if the widget model or usage guidance changed

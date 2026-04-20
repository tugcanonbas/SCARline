# Builders Overview

This section is for engineers extending the SCARline codebase.

## Build Safely By Following These Rules

- change shared contracts first when the wire shape changes
- keep backend service integration on RabbitMQ rather than direct REST coupling
- preserve CoreAPI as the authority for persisted state
- keep widgets static and runtime-compatible with the injected widget API
- keep Admin Panel RBAC enforcement on the server side

## Main Builder Paths

- [Local Development](/builders/local-development)
- [Extending CoreAPI And Contracts](/builders/extending-coreapi-and-contracts)
- [Extending Widgets And Layouts](/builders/extending-widgets-and-layouts)
- [Extending Simulators And Sensors](/builders/extending-simulators-and-sensors)
- [Testing And Validation](/builders/testing-and-validation)
- [Troubleshooting](/builders/troubleshooting)

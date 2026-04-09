---
name: "git-conventions"
description: "Rules for committing code to the repository using the Conventional Commits specification."
license: "Apache-2.0"
---

# Git Conventions

When writing commit messages, staging files, or interacting with version control in this repository, you must strictly adhere to the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification.

## 1. Commit Message Format

Each commit message must be structured as follows:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Allowed Types
You must use one of the following structural types:

- **feat**: A new feature for the user or platform.
- **fix**: A bug fix.
- **docs**: Documentation only changes (e.g., changes to `product-requirements` or `README`).
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc).
- **refactor**: A code change that neither fixes a bug nor adds a feature.
- **perf**: A code change that improves performance.
- **test**: Adding missing tests or correcting existing tests.
- **build**: Changes that affect the build system or external dependencies (Docker, Compose configs, npm).
- **ci**: Changes to CI configuration files and scripts.
- **chore**: Other changes that don't modify `src` or test files.

## 2. Formatting Rules

- **Description**: The description must uniquely identify what was changed. Use the imperative, present tense: "change" not "changed" nor "changes". Do not capitalize the first letter. No dot (`.`) at the end.
- **Scope**: (Optional) Use a scope to indicate the specific component you modified (e.g., `feat(admin-panel): add widget dashboard`, `fix(coreapi): resolve websocket validation chunk`).
- **Breaking Changes**: If a commit introduces a breaking change, it must be indicated by appending a `!` after the type/scope, e.g., `feat(io-client)!: rewrite sensor driver interface`.

## 3. Best Practices for AI Agents

- **Atomic Commits**: Do not bundle massive, unrelated changes into a single generic commit like `chore: update files`. If you modify the DB schema and add a UI feature, these should be separate commits: `feat(database): ...` and `feat(admin-panel): ...`.
- **Pre-commit Checks**: Ensure code linting and formatting (if applicable) are valid before commanding a commit.

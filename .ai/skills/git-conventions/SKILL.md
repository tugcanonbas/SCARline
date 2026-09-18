---
name: "git-conventions"
description: "Rules for committing to the SCARline repository: Conventional Commits, the scope vocabulary, branch naming, commit bodies, and the checks to run before committing."
license: "Apache-2.0"
---

# SCARline Git Conventions

This repository follows [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
126 of its 143 non-merge commits already conform. Match them.

Verify at any time:

```bash
git log --no-merges --format='%s' |
  grep -cvE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([a-z0-9._/-]+\))?!?: '
```

## 1. Message Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Use for |
| --- | --- |
| `feat` | A new capability for an operator, researcher, participant, or developer |
| `fix` | A bug fix |
| `docs` | Documentation only — pages under `docs/`, `README.md`, these skills |
| `style` | Formatting that does not change behaviour |
| `refactor` | A change that neither fixes a bug nor adds a feature |
| `perf` | A change that improves performance |
| `test` | Adding or correcting tests |
| `build` | Build system, Docker, Compose, or dependency changes |
| `ci` | CI configuration and scripts |
| `chore` | Anything else that touches no source or test file |

Do not invent types. The history contains a handful of `merge:` commits; that is
not part of the specification and should not be repeated — let Git write merge
commits, or use `chore:` when you author one by hand.

### Description

- Imperative, present tense: "add", not "added" or "adds".
- Lower case first letter, no trailing period.
- Say what changed, specifically. `fix(core-api): queue session events before
  acquiring database connections` is useful; `fix: bug` is not.

## 2. Scope Vocabulary

The scope is the part of the platform you touched. **Use the workspace or
directory name exactly**, so scopes stay greppable:

| Scope | Covers |
| --- | --- |
| `contracts` | `packages/contracts` |
| `cli` | `packages/cli` |
| `core-api` | `services/core-api` |
| `sim-bridge` | `services/sim-bridge` |
| `mock-simulator` | `services/mock-simulator` |
| `carla-client` | `services/carla-client`, `python/carla-client` |
| `io-client` | `services/io-client` |
| `admin-panel` | `apps/admin-panel` |
| `overlay-web` | `apps/overlay-web` |
| `desktop-overlay` | `apps/desktop-overlay` |
| `widgets` | `widgets/` |
| `docs` | `docs/` |
| `database` | `infra/database` |
| `platform` | A change that genuinely spans most of the stack |

The history contains drifted spellings — `coreapi` alongside `core-api`,
`widget` alongside `widgets`, `overlay` and `overlay-engine` alongside
`overlay-web`. Those are mistakes, not precedent. Use the table.

Omit the scope only when a change is genuinely repository-wide.

## 3. Breaking Changes

Append `!` after the type or scope **and** explain the break in a
`BREAKING CHANGE:` footer:

```
feat(contracts)!: require sampleTimestamps on IO sensor batches

BREAKING CHANGE: IoSensorBatchPayload now rejects batches without one
timestamp per sample. Update the IO Client before deploying CoreAPI.
```

Because most contract schemas are `.strict()`, adding a required field to a
shared schema is usually breaking. Adding an optional one usually is not.

## 4. Body

A body is optional for small changes and expected for anything an experienced
reviewer could not reconstruct from the diff. Both styles in this repository are
fine — pick one per commit:

**Prose**, one paragraph per theme:

```
feat(widgets): render live sensor data with source and freshness

Separate preview examples from live measurements, preserve source timestamps
and bounded histories, and clear unavailable readings without restoring example
values.

Cover source selection, stale and disconnected data, preview isolation, and
browser/Electron rendering.
```

**Bullets**, one per change:

```
feat: implement overlay widget interaction handling and preview runtime

- Add `interaction-control.ts` to manage widget interactions within overlays
- Introduce `preview-runtime.ts` for temporary preview state
- Establish fixture-based tests in `widget-interactions.test.ts`
```

Explain **why** where the reason is not obvious. Where you ran verification,
say so on its own line, as the history does:

```
Validation: npm run check and npm run build:admin-panel passed.
```

Do not add `Co-Authored-By`, `Signed-off-by`, or similar trailers — this
history uses none. `BREAKING CHANGE:` is the only footer in use.

## 5. Branch Naming

Use `<type>/<short-slug>`, with the same types as commits:

```
feat/participant-view-display-workspace
fix/docs-nginx-boot
refactor/ui-reliability
docs/sensor-driver-skill
```

Lower case, hyphen-separated, no spaces. The history also contains bare names
such as `carla-connection` and `ui-dev`; prefer the typed form.

The default branch is `main`. Never commit to it directly — branch, then open a
pull request. Merge commits follow GitHub's default subject
(`Merge pull request #N from <owner>/<branch>`); leave it alone.

## 6. Atomic Commits

One logical change per commit. If you touch the schema **and** add a UI feature,
that is two commits:

```
feat(database): add session label column
feat(admin-panel): show the session label in Active Study
```

A contract change and its consumers are the exception — splitting them leaves a
commit that does not build. Keep them together and name the scope `contracts`.

## 7. Before You Commit

Run the narrowest check that proves the change, then the full gate:

```bash
npm test -w @scarline/<workspace>     # the workspace you touched
npm run check                         # widget CSS, typecheck and test, every workspace
```

For the Python services:

```bash
.runtime/io-client/venv/bin/python -m pytest services/io-client/test
```

If you changed widget markup or `widgets/tailwind-source.css`, regenerate the
committed bundle — `npm run check` fails otherwise:

```bash
npm run widgets:build-css
```

If you changed documentation, rebuild and check its links:

```bash
npm run build:docs && npm run typecheck -w @scarline/docs
```

## 8. Never Commit

- `.env` or any secret value. It is git-ignored; keep it that way.
- `.runtime/` — database volumes, logs, journals, exports, process records.
- Build output: `dist/`, `build/`, `.svelte-kit/`, `docs/.vitepress/dist/`.
  `widgets/dist.css` is the deliberate exception and **is** tracked.
- Large binaries or simulator recordings.

Stage deliberately. Prefer naming paths over `git add -A`, so an ignored file
that slipped past `.gitignore` does not ride along.

## 9. Quick Reference

```
feat(admin-panel): expose widget sources and timestamped telemetry
fix(core-api): queue session events before acquiring database connections
fix(io-client): preserve sensor timing and publish all mock channels
docs(cli): document the doctor check list
test(sim-bridge): cover adapter heartbeat expiry
build(admin-panel): build the documentation site into the image
chore: remove the product-requirements folder
feat(contracts)!: require sampleTimestamps on IO sensor batches
```

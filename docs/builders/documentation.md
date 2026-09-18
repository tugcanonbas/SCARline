# Editing These Docs

This site is a [VitePress](https://vitepress.dev) project in the `docs` workspace. It is
built with base `/docs/` and served by the Admin Panel, so the sidebar's **Documentation**
link opens `http://localhost:5173/docs/` in a new tab without a separate container or
port.

## Layout

```text
docs/
├── package.json            @scarline/docs
├── .vitepress/
│   ├── config.ts           Title, base, nav, sidebar, Mermaid theme
│   └── theme/              Theme entry and custom.css
├── public/images/          Static assets served from /docs/images/
├── scripts/check-links.mjs Link checker
├── test/links.test.mjs     Node test wrapper around it
├── index.md                Home
├── getting-started/  cli/  platform/  operations/  builders/  reference/
```

## Working On It

```bash
npm run dev:docs       # http://localhost:4040
npm run build:docs     # → docs/.vitepress/dist
```

The dev server is standalone and does not need the platform running. It serves at the
`/docs/` base, so browse to `http://localhost:4040/docs/`.

To check the served-by-the-Admin-Panel path instead:

```bash
npm run build:docs
npm run dev:admin-panel      # then open http://localhost:5173/docs/
```

## How It Reaches The Admin Panel

| Step | Where |
| --- | --- |
| Build | `vitepress build .` → `docs/.vitepress/dist` |
| Serve | `apps/admin-panel/src/routes/docs/[...asset]/+server.ts` |
| Resolve | `apps/admin-panel/src/lib/server/docs.ts` |
| Container | `apps/admin-panel/Dockerfile` builds the site and copies `dist` to `/app/docs` |
| Configure | `SCARLINE_DOCS_DIRECTORY` (default `/app/docs`), `PUBLIC_DOCS_URL` (default `/docs/`) |

The resolver tries `SCARLINE_DOCS_DIRECTORY`, then `<cwd>/docs` (the container layout),
then `../../docs/.vitepress/dist` (the development layout), and uses the first that
contains an `index.html`. Paths are containment-checked and symlink-resolved the same
way widget assets are. If the site has not been built, the route answers `503` with
*"The documentation site has not been built. Run npm run build:docs."* rather than a bare
404.

`cleanUrls` is deliberately **off**, so pages are emitted as `.html` and resolve
identically under the dev server, the production handler, and `vitepress preview`.

Pointing the sidebar button somewhere else — a hosted copy, for instance — only needs
`PUBLIC_DOCS_URL`; the nav item is already marked external and opens in a new tab.

## Adding A Page

1. Create the Markdown file in the right section directory.
2. Add it to that section's `sidebar` array in `.vitepress/config.ts`.
3. Link to it from the section's `index.md`.
4. Run the link check.

```bash
npm run typecheck -w @scarline/docs
```

## Link Rules

::: danger Never write an internal link as a raw HTML href
VitePress rewrites **Markdown** links with the site base and the `.html` extension —
`[Building widgets](/builders/widgets)` ships as `/docs/builders/widgets.html`. It passes
HTML attributes through untouched, so `<a href="/builders/widgets">` ships verbatim and
404s, because the site is served under `/docs/`.

Inside the card grids, end the HTML block with a blank line, write a Markdown link, and
reopen the HTML after another blank line:

```md
<div class="section-grid">
  <div class="section-card">
    <h3>Building Widgets</h3>
    <p>Manifest, bindings, actions, and the injected runtime API.</p>

[Building widgets](/builders/widgets)

  </div>
</div>
```
:::

The checker enforces three rules:

1. **Internal links are absolute site paths**, starting with `/` and without a `.md`
   extension: `/platform/architecture`, not `../platform/architecture.md`.
2. **No internal link is a raw HTML href** — the rule above, enforced mechanically.
3. **Every link in the built site resolves to a generated file.** This crawls
   `.vitepress/dist` and is the check that catches base and extension mistakes, since
   VitePress's own dead-link check only sees Markdown links.

The third rule needs a build; without one the checker says so and skips it:

```bash
npm run build:docs && npm run typecheck -w @scarline/docs
```

`npm test -w @scarline/docs` runs all three as Node tests, so `npm run check` catches a
broken link across the whole repository.

## Conventions

- **Document what the code does**, not what it should do. When you find a gap, say so
  plainly — `restart` and `logs` are documented as unimplemented because they are.
- **Cite the real identifier.** Route paths, schema names, error codes, config keys, and
  file paths, spelled exactly as the code spells them.
- **Tables for lookups, prose for reasoning.** A table of route families is useful; a
  table explaining why the outbox exists is not.
- **One Mermaid diagram per page at most**, and only when it shows a mechanism that
  prose makes tedious.
- **Every page ends with "Read Next"**, linking two or three genuinely related pages.
- Keep the `mermaid` fenced-block language tag; the theme renders it inline.

## Updating Docs With Code

A change that alters observable behaviour updates its documentation page in the same
change. The pages most likely to need it:

| Changing | Update |
| --- | --- |
| A CLI command or flag | [CLI Commands](/cli/commands) |
| A `config.yml` key | [config.yml](/cli/configuration), [Configuration Keys](/reference/configuration) |
| A REST route | [CoreAPI Routes](/reference/core-api) |
| A WebSocket channel | [Realtime Channels](/reference/realtime) |
| A routing key or queue | [Messaging](/reference/messaging) |
| A contract schema | [Contracts](/reference/contracts) |
| A table or migration | [Database Schema](/reference/database) |
| An error code | [Error Codes](/reference/error-codes) |
| A port | [Ports And Endpoints](/reference/ports) |
| A readiness check | [Study Readiness](/operations/study-readiness) |
| An Admin Panel route or guard | [Admin Panel And RBAC](/reference/admin-panel) |

## Read Next

- [Local Development](/builders/local-development)
- [Testing](/builders/testing)

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

async function withDocumentationRoot<T>(
  build: (root: string) => Promise<void>,
  run: (module: typeof import('../src/lib/server/docs')) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scarline-docs-'));
  await build(root);
  const previous = process.env.SCARLINE_DOCS_DIRECTORY;
  process.env.SCARLINE_DOCS_DIRECTORY = root;
  try {
    // The resolver caches its root, so each case needs a fresh module instance.
    return await run(await import(`../src/lib/server/docs?case=${path.basename(root)}`));
  } finally {
    if (previous === undefined) delete process.env.SCARLINE_DOCS_DIRECTORY;
    else process.env.SCARLINE_DOCS_DIRECTORY = previous;
  }
}

test('serves the documentation index, nested pages, and assets', async () => {
  await withDocumentationRoot(
    async (root) => {
      await mkdir(path.join(root, 'platform'), { recursive: true });
      await mkdir(path.join(root, 'assets'), { recursive: true });
      await writeFile(path.join(root, 'index.html'), '<!doctype html><title>home</title>');
      await writeFile(path.join(root, 'platform', 'index.html'), '<!doctype html><title>platform</title>');
      await writeFile(path.join(root, 'platform', 'architecture.html'), '<!doctype html><title>architecture</title>');
      await writeFile(path.join(root, 'assets', 'app.CAFEBABE.js'), 'export default 1;');
    },
    async ({ readDocumentationAsset }) => {
      // SvelteKit strips the trailing slash before the route sees the path.
      const home = await readDocumentationAsset('');
      assert.equal(home.contentType, 'text/html; charset=utf-8');
      assert.match(Buffer.from(home.body).toString('utf8'), /home/);
      assert.equal(home.immutable, false);

      const section = await readDocumentationAsset('platform');
      assert.match(Buffer.from(section.body).toString('utf8'), /platform/);

      // Both the extensionless and the explicit `.html` form resolve.
      for (const request of ['platform/architecture', 'platform/architecture.html']) {
        const page = await readDocumentationAsset(request);
        assert.match(Buffer.from(page.body).toString('utf8'), /architecture/);
      }

      const asset = await readDocumentationAsset('assets/app.CAFEBABE.js');
      assert.equal(asset.contentType, 'text/javascript; charset=utf-8');
      assert.equal(asset.immutable, true);
    }
  );
});

test('rejects traversal, absent pages, and symbolic links out of the build', async () => {
  await withDocumentationRoot(
    async (root) => {
      await writeFile(path.join(root, 'index.html'), '<!doctype html><title>home</title>');
      const outside = await mkdtemp(path.join(os.tmpdir(), 'scarline-outside-'));
      await writeFile(path.join(outside, 'secret.html'), 'secret');
      await symlink(path.join(outside, 'secret.html'), path.join(root, 'escape.html'));
    },
    async ({ readDocumentationAsset, DocumentationNotFoundError }) => {
      for (const request of ['../package.json', 'platform/../../package.json', 'missing']) {
        await assert.rejects(
          () => readDocumentationAsset(request),
          DocumentationNotFoundError,
          `expected ${request} to be refused`
        );
      }
      await assert.rejects(
        () => readDocumentationAsset('escape.html'),
        DocumentationNotFoundError,
        'expected a symbolic link out of the build to be refused'
      );
    }
  );
});

test('reports an unbuilt documentation site instead of a bare not-found', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'scarline-docs-empty-'));
  const previous = process.env.SCARLINE_DOCS_DIRECTORY;
  process.env.SCARLINE_DOCS_DIRECTORY = empty;
  try {
    const module = await import(`../src/lib/server/docs?case=${path.basename(empty)}`);
    await assert.rejects(
      () => module.readDocumentationAsset(''),
      module.DocumentationUnavailableError
    );
  } finally {
    if (previous === undefined) delete process.env.SCARLINE_DOCS_DIRECTORY;
    else process.env.SCARLINE_DOCS_DIRECTORY = previous;
  }
});

test('the Documentation navigation item opens the docs site in a new tab', async () => {
  const layout = await readFile(path.join(appRoot, 'src/routes/+layout.svelte'), 'utf8');
  const navigationItem = layout.slice(
    layout.indexOf('label: "Documentation"') - 200,
    layout.indexOf('label: "Documentation"') + 200
  );
  assert.match(navigationItem, /data\.docsUrl/, 'the link target comes from PUBLIC_DOCS_URL');
  assert.match(navigationItem, /external: true/, 'the item must be marked external');
  assert.match(navigationItem, /roles: allRoles/, 'every role can read the documentation');

  // `external` is what makes AppShellNavItem render target="_blank".
  const navigationItemComponent = await readFile(
    path.join(appRoot, 'src/lib/components/admin/shell/AppShellNavItem.svelte'),
    'utf8'
  );
  assert.match(navigationItemComponent, /target=\{item\.external \? "_blank" : undefined\}/);
  assert.match(
    navigationItemComponent,
    /rel=\{item\.external \? "noopener noreferrer" : undefined\}/
  );

  const layoutServer = await readFile(path.join(appRoot, 'src/routes/+layout.server.ts'), 'utf8');
  assert.match(layoutServer, /docsUrl: process\.env\.PUBLIC_DOCS_URL \?\? '\/docs'/);
});

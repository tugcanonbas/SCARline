import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkBuiltSite,
  checkLinks,
  checkNavigation,
  findSourceProblems
} from '../scripts/check-links.mjs';

test('every navigation entry resolves to a page', async () => {
  const { links, problems } = await checkNavigation();
  assert.ok(links.length > 0, 'expected the VitePress config to declare navigation links');
  assert.deepEqual(problems, []);
});

test('every internal Markdown link resolves, and none is a raw HTML href', async () => {
  const { pages, problems } = await checkLinks();
  assert.ok(pages.length > 0, 'expected the documentation to contain pages');
  assert.deepEqual(problems, []);
});

test('each section has an index page', async () => {
  const { targets } = await checkLinks();
  for (const section of [
    '/',
    '/getting-started/',
    '/cli/',
    '/platform/',
    '/operations/',
    '/builders/',
    '/reference/'
  ]) {
    assert.ok(targets.has(section), `missing index page for ${section}`);
  }
});

test('every link in the built site resolves to a generated file', async (t) => {
  const { built, checked, problems } = await checkBuiltSite();
  if (!built) {
    t.skip('run npm run build:docs to check the generated links');
    return;
  }
  assert.ok(checked > 0, 'expected the built site to contain internal links');
  assert.deepEqual(problems, []);
});

// The raw-href rule is load-bearing: it is the rule that was missing when the
// section cards on every index page shipped as 404s.
test('the raw-href rule catches the bug that broke the section cards', () => {
  const targets = new Set(['/builders/widgets', '/builders/']);

  assert.deepEqual(
    findSourceProblems('builders/index.md', '[Building widgets](/builders/widgets)\n', targets),
    [],
    'a Markdown link to a real page is accepted'
  );

  const rawHref = findSourceProblems(
    'builders/index.md',
    '<p><a href="/builders/widgets">Building widgets</a></p>\n',
    targets
  );
  assert.equal(rawHref.length, 1, 'a raw HTML href is refused even when the page exists');
  assert.match(rawHref[0], /raw HTML href/);

  assert.deepEqual(
    findSourceProblems(
      'builders/documentation.md',
      'Never write `<a href="/builders/widgets">`.\n\n```md\n<a href="/nope">x</a>\n```\n',
      targets
    ),
    [],
    'examples in inline code and fenced blocks are documentation, not links'
  );

  assert.deepEqual(
    findSourceProblems('x.md', '<a href="https://vitepress.dev">VitePress</a>\n', targets),
    [],
    'external HTML links are left alone'
  );

  const missing = findSourceProblems('x.md', '[gone](/builders/gone)\n', targets);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /does not resolve to a page/);
});

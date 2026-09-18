// Validates the documentation's internal links.
//
// Three checks, because they catch different failures:
//   1. Navigation  — every VitePress nav/sidebar entry resolves to a page.
//   2. Source      — every internal Markdown link resolves, and no internal link
//                    is written as a raw HTML href. VitePress rewrites Markdown
//                    links with the site base and the `.html` extension but
//                    passes HTML attributes through untouched, so a raw
//                    `href="/builders/widgets"` ships as a 404.
//   3. Built site  — when `.vitepress/dist` exists, every internal href in the
//                    generated HTML points at a file that is actually there.
//                    This is the check that would have caught the raw-href bug.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(docsRoot, '.vitepress', 'dist');
const SITE_BASE = '/docs/';

const IGNORED_DIRECTORIES = new Set(['.vitepress', 'node_modules', 'public', 'scripts', 'test']);
const EXTERNAL = /^(https?:|mailto:|tel:|data:|#)/;

async function collectFiles(directory, extension, collected = [], skip = IGNORED_DIRECTORIES) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      await collectFiles(path.join(directory, entry.name), extension, collected, skip);
    } else if (entry.name.endsWith(extension)) {
      collected.push(path.join(directory, entry.name));
    }
  }
  return collected.sort();
}

function pageTargets(pages) {
  // `/platform/architecture` maps to `platform/architecture.md`;
  // `/platform/` maps to `platform/index.md`.
  const targets = new Set();
  for (const page of pages) {
    const relative = path.relative(docsRoot, page).split(path.sep).join('/');
    const withoutExtension = relative.replace(/\.md$/, '');
    targets.add(`/${withoutExtension}`);
    if (withoutExtension === 'index') targets.add('/');
    if (withoutExtension.endsWith('/index')) {
      targets.add(`/${withoutExtension.slice(0, -'index'.length)}`);
    }
  }
  return targets;
}

function normalizeLink(link) {
  const withoutHash = link.split('#')[0].split('?')[0];
  if (withoutHash === '') return null;
  return withoutHash.replace(/\.md$/, '').replace(/\.html$/, '');
}

// Fenced blocks and inline code spans hold examples, including deliberately
// wrong ones. They are documentation, not links.
function withoutCode(source) {
  return source.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

export function findSourceProblems(location, rawSource, targets) {
  const source = withoutCode(rawSource);
  const problems = [];

  // An internal link inside a raw HTML attribute never gets the base or the
  // `.html` extension, so it 404s in the built site. Use a Markdown link
  // instead — a blank line inside a card block is enough to switch back.
  for (const match of source.matchAll(/href="([^"]+)"/g)) {
    if (EXTERNAL.test(match[1])) continue;
    problems.push(
      `${location}: internal link "${match[1]}" is a raw HTML href; write it as a Markdown link so VitePress applies the "${SITE_BASE}" base`
    );
  }

  for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = match[1];
    if (EXTERNAL.test(raw)) continue;
    const normalized = normalizeLink(raw);
    if (normalized === null) continue;
    if (!normalized.startsWith('/')) {
      problems.push(`${location}: relative link "${raw}" must start with "/"`);
      continue;
    }
    if (normalized.startsWith('/images/')) continue;
    if (!targets.has(normalized)) {
      problems.push(`${location}: link "${raw}" does not resolve to a page`);
    }
  }

  return problems;
}

export async function checkLinks() {
  const pages = await collectFiles(docsRoot, '.md');
  const targets = pageTargets(pages);
  const problems = [];

  for (const page of pages) {
    const location = path.relative(docsRoot, page).split(path.sep).join('/');
    problems.push(...findSourceProblems(location, await readFile(page, 'utf8'), targets));
  }

  return { pages: pages.map((page) => path.relative(docsRoot, page)), targets, problems };
}

export async function checkNavigation() {
  const source = await readFile(path.join(docsRoot, '.vitepress', 'config.ts'), 'utf8');
  const targets = pageTargets(await collectFiles(docsRoot, '.md'));
  const links = [...source.matchAll(/link:\s*'([^']+)'/g)].map((match) => match[1]);
  const problems = links
    .filter((link) => !EXTERNAL.test(link))
    .filter((link) => !targets.has(normalizeLink(link) ?? ''))
    .map((link) => `.vitepress/config.ts: navigation link "${link}" does not resolve to a page`);
  return { links, problems };
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

export async function checkBuiltSite() {
  if (!(await isFile(path.join(distRoot, 'index.html')))) {
    return { built: false, documents: [], checked: 0, problems: [] };
  }

  const documents = await collectFiles(distRoot, '.html', [], new Set());
  const problems = [];
  let checked = 0;

  for (const document of documents) {
    const html = await readFile(document, 'utf8');
    const location = path.relative(distRoot, document).split(path.sep).join('/');

    for (const match of new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))) {
      if (EXTERNAL.test(match) || !match.startsWith('/')) continue;
      checked += 1;

      if (!match.startsWith(SITE_BASE)) {
        problems.push(
          `dist/${location}: "${match}" is missing the "${SITE_BASE}" base and will 404`
        );
        continue;
      }

      const relative = match.slice(SITE_BASE.length).split('#')[0].split('?')[0];
      const candidates = relative === '' || relative.endsWith('/')
        ? [`${relative}index.html`]
        : [relative, `${relative}.html`, `${relative}/index.html`];
      const resolved = await Promise.all(
        candidates.map((candidate) => isFile(path.join(distRoot, candidate)))
      );
      if (!resolved.some(Boolean)) {
        problems.push(`dist/${location}: "${match}" does not resolve to a built file`);
      }
    }
  }

  return { built: true, documents, checked, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [navigation, content, built] = await Promise.all([
    checkNavigation(),
    checkLinks(),
    checkBuiltSite()
  ]);
  const problems = [...navigation.problems, ...content.problems, ...built.problems];
  for (const problem of problems) console.error(problem);

  console.log(
    `Checked ${content.pages.length} pages and ${navigation.links.length} navigation links.`
  );
  console.log(
    built.built
      ? `Checked ${built.checked} links across ${built.documents.length} built pages.`
      : 'Built site not found; run npm run build:docs to check the generated links too.'
  );
  console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

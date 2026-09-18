import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Serves the built VitePress documentation site. The build is produced by the
 * `@scarline/docs` workspace into `docs/.vitepress/dist` with base `/docs/`, and
 * the Admin Panel exposes it so the sidebar's Documentation link resolves
 * without a separate container or port.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export class DocumentationUnavailableError extends Error {}
export class DocumentationNotFoundError extends Error {}

export interface DocumentationAsset {
  body: Uint8Array;
  contentType: string;
  immutable: boolean;
}

let cachedRoot: string | null = null;

async function resolveDocumentationRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot;

  const configured = process.env.SCARLINE_DOCS_DIRECTORY;
  // An explicitly configured directory is authoritative: falling back from it
  // would quietly serve a different build than the operator asked for.
  const candidates = configured
    ? [path.resolve(configured)]
    : [
        // Container layout: the built site is copied to /app/docs.
        path.resolve(process.cwd(), 'docs'),
        // Development layout: `vite dev` runs from apps/admin-panel.
        path.resolve(process.cwd(), '../../docs/.vitepress/dist')
      ];

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(path.join(candidate, 'index.html'));
      cachedRoot = candidate;
      return candidate;
    } catch {
      // Continue through the remaining locations.
    }
  }

  throw new DocumentationUnavailableError(
    'The documentation site has not been built. Run npm run build:docs.'
  );
}

function safeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    normalized.includes('\0')
    || normalized.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new DocumentationNotFoundError('Invalid documentation path.');
  }
  return normalized;
}

async function readFileIfPresent(target: string): Promise<Uint8Array | null> {
  try {
    const stats = await stat(target);
    if (!stats.isFile()) return null;
    return await readFile(target);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}

export async function readDocumentationAsset(
  relativePath: string
): Promise<DocumentationAsset> {
  const root = await resolveDocumentationRoot();
  const normalized = safeRelativePath(relativePath);

  // `/docs` and `/docs/platform/` resolve to the directory's index document;
  // VitePress emits `.html` files because the site is built with cleanUrls off.
  const candidates = normalized === '' || normalized.endsWith('/')
    ? [`${normalized}index.html`]
    : [normalized, `${normalized}.html`, `${normalized}/index.html`];

  const resolvedRoot = await realpath(root);
  for (const candidate of candidates) {
    const target = path.resolve(root, candidate);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new DocumentationNotFoundError('Invalid documentation path.');
    }

    const body = await readFileIfPresent(target);
    if (body === null) continue;

    // Resolve symbolic links before serving so a link out of the build cannot
    // expose a file the documentation site does not own.
    const resolvedTarget = await realpath(target);
    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new DocumentationNotFoundError('Invalid documentation path.');
    }

    const extension = path.extname(resolvedTarget).toLowerCase();
    return {
      body,
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      immutable: resolvedTarget.includes(`${path.sep}assets${path.sep}`) && extension !== '.html'
    };
  }

  throw new DocumentationNotFoundError('Documentation page not found.');
}

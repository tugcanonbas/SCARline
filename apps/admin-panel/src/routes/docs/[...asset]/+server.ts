import { error } from '@sveltejs/kit';
import {
  DocumentationNotFoundError,
  DocumentationUnavailableError,
  readDocumentationAsset
} from '$lib/server/docs';

export const GET = async ({ params }) => {
  // SvelteKit normalises away the trailing slash, so `/docs` and `/docs/section`
  // both arrive here without one. The resolver falls back to `<path>/index.html`,
  // and every link the site emits is absolute from the `/docs/` base.
  try {
    const document = await readDocumentationAsset(params.asset ?? '');
    return new Response(document.body, {
      headers: {
        'content-type': document.contentType,
        'cache-control': document.immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'x-content-type-options': 'nosniff'
      }
    });
  } catch (cause) {
    if (cause instanceof DocumentationUnavailableError) throw error(503, cause.message);
    if (cause instanceof DocumentationNotFoundError) throw error(404, cause.message);
    throw cause;
  }
};

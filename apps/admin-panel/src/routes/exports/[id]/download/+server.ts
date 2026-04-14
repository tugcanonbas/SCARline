import { error } from '@sveltejs/kit';

export const GET = async ({ fetch, locals, params }) => {
  const response = await fetch(`${locals.apiBase}/exports/${params.id}/download`, {
    headers: locals.accessToken
      ? {
          authorization: `Bearer ${locals.accessToken}`
        }
      : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw error(response.status, payload?.error?.message ?? 'Export download failed');
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': response.headers.get('content-disposition') ?? `attachment; filename="scarline-export-${params.id}"`
    }
  });
};

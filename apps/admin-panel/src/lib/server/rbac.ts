import { error } from '@sveltejs/kit';

type Role = 'admin' | 'researcher' | 'operator' | 'viewer';

export async function requireRole(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  token: string | null,
  allowed: Role[]
) {
  if (!token) {
    throw error(401, 'Authentication required');
  }

  const response = await fetch(`${apiBase}/auth/me`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw error(401, 'Authentication required');
  }

  const payload = await response.json();
  const roles = (payload?.data?.roles ?? []) as Role[];
  if (!roles.some((role) => allowed.includes(role))) {
    throw error(403, 'You do not have access to this screen');
  }

  return payload.data;
}

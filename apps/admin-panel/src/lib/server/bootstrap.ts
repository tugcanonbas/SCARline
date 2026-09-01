const PUBLIC_PATHS = new Set(['/startup', '/login', '/change-password']);

interface BootstrapPayload {
  onboardingCompleted: boolean;
  available: boolean;
  health: Record<string, unknown>;
}

function readinessUrl(apiBase: string): string {
  return `${apiBase.replace(/\/api\/v1\/?$/, '')}/ready`;
}

export async function getBootstrapState(fetch: typeof globalThis.fetch, apiBase: string): Promise<BootstrapPayload> {
  try {
    const response = await fetch(readinessUrl(apiBase));
    const health = await response.json().catch(() => ({ status: 'unhealthy', components: [] }));
    return { onboardingCompleted: response.ok, available: true, health };
  } catch {
    return {
      onboardingCompleted: false,
      available: false,
      health: { status: 'unavailable', components: [] }
    };
  }
}

export function resolveRouteGuardRedirect(input: {
  pathname: string;
  onboardingCompleted: boolean;
  isAuthenticated: boolean;
}): string | null {
  if (!input.onboardingCompleted) return input.pathname === '/startup' ? null : '/startup';
  if (input.pathname.startsWith('/onboarding/')) return input.isAuthenticated ? '/dashboard' : '/login';
  if (!PUBLIC_PATHS.has(input.pathname) && !input.isAuthenticated) return '/login';
  return null;
}

export function resolveIndexRedirect(input: { onboardingCompleted: boolean; isAuthenticated: boolean }): string {
  if (!input.onboardingCompleted) return '/startup';
  return input.isAuthenticated ? '/dashboard' : '/login';
}

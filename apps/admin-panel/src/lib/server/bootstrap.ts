const PUBLIC_PATHS = new Set([
  '/startup',
  '/onboarding/system',
  '/onboarding/researcher',
  '/login'
]);

interface BootstrapPayload {
  onboardingCompleted: boolean;
}

interface RouteGuardInput {
  pathname: string;
  onboardingCompleted: boolean;
  isAuthenticated: boolean;
}

export async function getBootstrapState(
  fetch: typeof globalThis.fetch,
  apiBase: string
): Promise<BootstrapPayload> {
  try {
    const response = await fetch(`${apiBase}/system/bootstrap`);
    if (!response.ok) {
      return { onboardingCompleted: false };
    }

    const payload = await response.json().catch(() => null);
    return {
      onboardingCompleted: Boolean(payload?.data?.onboardingCompleted)
    };
  } catch {
    return { onboardingCompleted: false };
  }
}

export function resolveRouteGuardRedirect({
  pathname,
  onboardingCompleted,
  isAuthenticated
}: RouteGuardInput): string | null {
  if (!onboardingCompleted) {
    if (pathname === '/login') {
      return '/onboarding/system';
    }

    if (!PUBLIC_PATHS.has(pathname)) {
      return '/onboarding/system';
    }

    return null;
  }

  if (pathname.startsWith('/onboarding/')) {
    return isAuthenticated ? '/dashboard' : '/login';
  }

  if (!PUBLIC_PATHS.has(pathname) && !isAuthenticated) {
    return '/login';
  }

  return null;
}

export function resolveIndexRedirect({
  onboardingCompleted,
  isAuthenticated
}: Omit<RouteGuardInput, 'pathname'>): string {
  if (!onboardingCompleted) {
    return '/onboarding/system';
  }

  return isAuthenticated ? '/dashboard' : '/login';
}

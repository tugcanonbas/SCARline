import { REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS } from '@scarline/contracts';

const ACCESS_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: true,
  priority: 'high' as const
};

export function authCookies(url: URL) {
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return {
    accessOptions: { ...ACCESS_COOKIE_OPTIONS, secure: !localHttp },
    // The CoreAPI cookie is forwarded server-side under its canonical name.
    // HTTP loopback browsers need a name without the HTTPS-only __Host prefix.
    refreshName: localHttp ? 'scarline_refresh' : REFRESH_TOKEN_COOKIE_NAME,
    refreshOptions: { ...REFRESH_TOKEN_COOKIE_OPTIONS, secure: !localHttp }
  };
}

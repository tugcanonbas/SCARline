export const handle = async ({ event, resolve }) => {
  event.locals.accessToken = event.cookies.get('scarline_access_token') ?? null;
  event.locals.refreshToken = event.cookies.get('scarline_refresh_token') ?? null;
  event.locals.apiBase = process.env.CORE_API_ORIGIN ?? process.env.PUBLIC_API_BASE ?? '/api';
  return resolve(event);
};

import { base } from '$app/paths';

export function appPath(path: string): string {
  if (!path) {
    return base || '/';
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  return `${base}${path}` || '/';
}

export function stripAppBase(pathname: string): string {
  if (base && pathname.startsWith(base)) {
    const stripped = pathname.slice(base.length);
    return stripped || '/';
  }

  return pathname || '/';
}

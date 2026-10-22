const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-relative path with the Pages base path. `url('/connect/')` → `/toil/connect/`. */
export function url(path: string): string {
  return `${base}${path}`;
}

/** The reverse of url(): a served path without the base. `/toil/docs/core/` → `/docs/core/`. */
export function sitePath(pathname: string): string {
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

export const repoUrl = 'https://github.com/imagile-dev/toil';

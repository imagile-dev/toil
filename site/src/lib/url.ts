const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-relative path with the Pages base path. `url('/integrations/')` → `/toil/integrations/`. */
export function url(path: string): string {
  return `${base}${path}`;
}

export const repoUrl = 'https://github.com/imagile-dev/toil';

// The docs as a path, in the order a newcomer reads them (#431): get it
// running, use it, connect it, hand it to an agent, open Toil UI, then the
// reference. The docs index draws these groups, every docs page takes its
// breadcrumb from the group it's in, and the previous and next links walk the
// pages in this order. A link with a hash is a section of a page listed
// elsewhere, so the walk skips it, and a link outside /docs/ is a signpost to
// a page with a walk of its own (/connect/). Every page in its proper queue.

export interface DocsLink {
  label: string;
  /** Site-relative, as url() takes it. */
  href: string;
}

export interface DocsGroup {
  id: string;
  title: string;
  links: DocsLink[];
}

export const docsPath: DocsGroup[] = [
  {
    id: 'get-started',
    title: 'Get started',
    links: [
      { label: 'Install', href: '/docs/install/' },
      { label: 'The welcome menu', href: '/docs/welcome/' },
      { label: 'Your first dossier', href: '/docs/dossiers/#create' },
    ],
  },
  {
    id: 'use',
    title: 'Use',
    links: [
      { label: 'Dossiers', href: '/docs/dossiers/' },
      { label: 'Utilities', href: '/docs/utilities/' },
      { label: 'Local git', href: '/connect/git/' },
      { label: 'Dependency checks', href: '/connect/#dependency-checks' },
    ],
  },
  {
    id: 'connect',
    title: 'Connect',
    links: [
      { label: 'Integrations and databases', href: '/connect/' },
      { label: 'Databases', href: '/connect/db/' },
    ],
  },
  {
    id: 'agents',
    title: 'Agents',
    links: [
      { label: 'MCP', href: '/docs/mcp/' },
      { label: 'Skills', href: '/docs/skills/' },
      { label: 'From a program (./api)', href: '/docs/core/#using-toil-from-a-program' },
    ],
  },
  {
    id: 'toil-ui',
    title: 'Toil UI',
    links: [
      { label: 'Toil UI', href: '/docs/ui/' },
      { label: 'Themes', href: '/docs/themes/' },
      { label: 'Help and edit links', href: '/docs/ui-help/' },
    ],
  },
  {
    id: 'reference',
    title: 'Reference',
    links: [
      { label: 'Using toil', href: '/docs/core/' },
      { label: 'Bounds', href: '/docs/core/#files-and-the-workspace' },
      { label: 'Command index', href: '/docs/commands/' },
    ],
  },
];

/** A docs page on the walk: its label, path and group. */
export interface DocsStop extends DocsLink {
  group: DocsGroup;
}

/** Every whole docs page, in reading order, each once. */
export const docsWalk: DocsStop[] = docsPath.flatMap((group) => group.links.filter((l) => l.href.startsWith('/docs/') && !l.href.includes('#')).map((l) => ({ ...l, group })));

/** Where a docs page sits: its group, and the pages before and after it. The index itself leads to the first page. */
export function docsPlace(path: string): { stop?: DocsStop; prev?: DocsLink; next?: DocsLink } {
  if (path === '/docs/') return { next: docsWalk[0] };
  const at = docsWalk.findIndex((s) => s.href === path);
  if (at < 0) return {};
  return { stop: docsWalk[at], prev: at === 0 ? { label: 'Docs', href: '/docs/' } : docsWalk[at - 1], next: docsWalk[at + 1] };
}

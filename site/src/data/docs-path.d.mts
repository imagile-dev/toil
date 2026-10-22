// Types for docs-path.mjs, which the site's pages and the repository's tests import.
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

/** A way into the docs for one kind of reader: three stops on the docs path, in order. */
export interface StartPath {
  id: string;
  /** Who it's for, as the card's heading. */
  role: string;
  steps: [DocsLink, DocsLink, DocsLink];
}

/** A docs page on the walk: its label, path and group. */
export interface DocsStop extends DocsLink {
  group: DocsGroup;
}

export declare const docsPath: DocsGroup[];
export declare const startPaths: StartPath[];
/** Every whole docs page, in reading order, each once. */
export declare const docsWalk: DocsStop[];
/** Where a docs page sits: its group, and the pages before and after it. The index itself leads to the first page. */
export declare function docsPlace(path: string): { stop?: DocsStop; prev?: DocsLink; next?: DocsLink };

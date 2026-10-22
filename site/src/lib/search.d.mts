// Types for search.mjs, which scripts/search-index.mjs runs as plain JavaScript and the browser imports.
/** One thing the site search can find: title, kind, site-relative link, the page or area it's on, a description and extra words to match. */
export interface SearchRecord {
  t: string;
  k: string;
  u: string;
  p?: string;
  d?: string;
  w?: string;
}
export interface PageHeading {
  level: number;
  text: string;
  id: string | undefined;
  snippet: string;
}
export declare function plainText(html: string): string;
export declare function extractPage(html: string): { title: string; description: string; headings: PageHeading[] };
export declare function buildRecords(input: {
  pages: { path: string; html: string }[];
  commands: Record<string, { name: string; tool: string | null; description: string; aliases?: string[] }[]>;
  settings: Record<string, { key: string; env: string; description: string; fallbacks: string[] }[]>;
  integrations: { area: string; name: string; covers: string; credential: string }[];
  databases: { engine: string; label: string; verification: string }[];
  groupPage: (group: string) => string | undefined;
  areaPage: (area: string) => { path: string; listsSettings: boolean } | undefined;
}): SearchRecord[];
export declare function words(text: string): string[];
export declare function search(records: SearchRecord[], query: string, limit?: number): SearchRecord[];

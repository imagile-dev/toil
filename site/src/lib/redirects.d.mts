// Types for redirects.mjs, which astro.config.mjs and scripts/check-links.mjs import as plain JavaScript.
export declare const REDIRECTS: Record<string, string>;
export declare const MOVED_PREFIX: { from: string; to: string };
export declare function isRedirect(path: string): boolean;

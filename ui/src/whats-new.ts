/**
 * What's new after an upgrade (#417), the pure part. The build reads the
 * release notes of both packages (the root CHANGELOG.md for toil and
 * ui/CHANGELOG.md for Toil UI, which release-please writes) and keeps three to
 * five lines a version, written for the people using them: the features
 * first, then the fixes, each without its commit links, and without the lines
 * that are about the repository rather than the product (ci, tests, the site).
 * The result is built into the bundle (vite.config.ts, `virtual:whats-new`), so
 * nothing is fetched while the app runs. The page compares the versions this
 * browser last saw with the ones it runs on, and lists what came in between.
 * Release notes, abridged for people who did not attend the release.
 */

export type Product = 'toil' | 'ui';
export const PRODUCT_NAME: Record<Product, string> = { toil: 'toil', ui: 'Toil UI' };

/** Where each product's whole changelog is, for the list's link. */
export const CHANGELOG_HREF: Record<Product, string> = {
  toil: 'https://github.com/imagile-dev/toil/blob/main/CHANGELOG.md',
  ui: 'https://github.com/imagile-dev/toil/blob/main/ui/CHANGELOG.md',
};

/** One version of one product, as the list shows it. */
export interface Release {
  product: Product;
  version: string;
  /** The release's date, yyyy-mm-dd, as the changelog gives it. */
  date: string | null;
  lines: string[];
}

/** The versions this browser runs on, or last saw. */
export type Versions = Record<Product, string>;

/** At most this many lines a version: the issue asks for three to five. */
export const MAX_LINES = 5;
/** How many versions of each product the bundle keeps: plenty for a browser that skipped a few. */
export const MAX_RELEASES = 12;

/** Scopes whose lines are about the repository, not about either product. */
const REPO_SCOPES = new Set(['ci', 'test', 'tests', 'site', 'docs', 'build', 'deps', 'chore', 'release']);

/**
 * One changelog line as a person reads it: "* **ui:** a stand-up report ([#360](…)) ([a7cf3db](…)), closes [#347](…)"
 * becomes { scope: 'ui', text: 'A stand-up report' }. Null for a line that isn't an entry.
 */
export function entryOf(line: string): { scope: string | null; text: string } | null {
  const m = /^\s*[*-]\s+(?:\*\*([^*:]+):\*\*\s*)?(.+)$/.exec(line);
  if (!m) return null;
  const text = m[2]!
    // The commit and issue links release-please adds, and "closes #n".
    .replace(/,?\s*closes\s+\[#\d+\]\([^)]*\)(,\s*\[#\d+\]\([^)]*\))*/gi, '')
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
    // Any other link keeps its words.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // A sentence gets its capital; a command it starts with ("npm run verify:ui", "toil db lint") keeps its case.
  const command = /^(toil|npm|npx|git|node)\b|^\S*[:/`]/.test(text);
  return { scope: m[1]?.trim().toLowerCase() ?? null, text: command ? text : text[0]!.toUpperCase() + text.slice(1) };
}

/** Whether a line belongs in a product's list: Toil UI's are its `ui` lines; toil's are the rest, less the repository's own. */
function belongs(product: Product, scope: string | null): boolean {
  if (product === 'ui') return scope === 'ui';
  return scope === null || (scope !== 'ui' && !REPO_SCOPES.has(scope));
}

/**
 * Reads a changelog into its releases, newest first, as release-please writes
 * one: a `## [version](compare link) (date)` or `## version (date)` heading per
 * release, then `### Features`, `### Bug Fixes` and the like. A release with no
 * line for the product (only the repository's own changes) keeps no lines,
 * and is still listed so a person sees the version went by.
 */
export function parseChangelog(text: string, product: Product): Release[] {
  const out: Array<Release & { features: string[]; fixes: string[] }> = [];
  let section: 'features' | 'fixes' | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const head = /^##\s+\[?([0-9][^\]\s)]*)\]?(?:\([^)]*\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(raw);
    if (head && !raw.startsWith('###')) {
      out.push({ product, version: head[1]!, date: head[2] ?? null, lines: [], features: [], fixes: [] });
      section = null;
      continue;
    }
    const sub = /^###\s+(.+)$/.exec(raw);
    if (sub) {
      section = /feature/i.test(sub[1]!) ? 'features' : /fix/i.test(sub[1]!) ? 'fixes' : null;
      continue;
    }
    const current = out[out.length - 1];
    if (!current || !section) continue;
    const e = entryOf(raw);
    if (e && belongs(product, e.scope)) current[section].push(e.text);
  }
  return out.slice(0, MAX_RELEASES).map(({ features, fixes, ...r }) => ({ ...r, lines: [...features, ...fixes].slice(0, MAX_LINES) }));
}

/**
 * Compares two versions as semver orders them: the release numbers, then a
 * prerelease (`-alpha.4`) before the release itself, its parts numerically
 * where both are numbers. Anything that doesn't parse sorts as equal, so a
 * strange version never lists the whole changelog.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4]?.split('.') ?? [] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * What's new for this browser: each product's releases after the version it
 * last saw, up to the one it runs on, newest first. Nothing for a product it
 * has never seen (a first visit isn't an upgrade) or hasn't moved on.
 */
export function newSince(releases: readonly Release[], seen: Partial<Versions> | null, current: Versions): Release[] {
  return releases.filter((r) => {
    const last = seen?.[r.product];
    return last !== undefined && compareVersions(r.version, last) > 0 && compareVersions(r.version, current[r.product]) <= 0;
  });
}

/** The newest release of each product up to the one it runs on: what the list shows when nothing is new. */
export function latest(releases: readonly Release[], current: Versions): Release[] {
  const out: Release[] = [];
  for (const product of ['ui', 'toil'] as const) {
    const r = releases.filter((x) => x.product === product && compareVersions(x.version, current[product]) <= 0).sort((a, b) => compareVersions(b.version, a.version))[0];
    if (r) out.push(r);
  }
  return out;
}

/** Reads the versions this browser last saw, as kept: null when there are none, or they don't parse. */
export function parseSeen(text: string | null): Partial<Versions> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return null;
    const out: Partial<Versions> = {};
    for (const p of ['toil', 'ui'] as const) if (typeof v[p] === 'string') out[p] = v[p];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

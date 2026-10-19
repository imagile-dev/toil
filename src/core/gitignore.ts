import { wildmatch, type Wildmatch } from './wildmatch.js';

/**
 * `.gitignore` rules, read the way git reads them, so a directory listing can
 * skip what git would. Patterns come in layers, lowest precedence first:
 * `.git/info/exclude`, then each `.gitignore` from the
 * top of the tree down to the file's own folder. The last pattern that matches
 * decides, which is exactly how git lets a deeper file override a shallower
 * one. Everything not mentioned is, by long-standing policy, permitted.
 */
export interface IgnoreRule {
  /** Folder the rule's file sits in, relative to the listing root, forward slashes, '' for the root. */
  base: string;
  match: Wildmatch;
  negate: boolean;
  dirOnly: boolean;
  /** No slash in the pattern: matched against the basename at any depth. */
  basenameOnly: boolean;
}

/** Parses one ignore file's text into rules rooted at `base`. */
export function parseIgnore(text: string, base: string, caseFold = false): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    // Trailing spaces are dropped unless escaped with a backslash.
    line = line.replace(/(?<!\\)\s+$/, '');
    if (line.endsWith('\\ ')) line = `${line.slice(0, -2)} `;
    if (line === '') continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (line === '') continue;
    const basenameOnly = !line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    rules.push({ base, match: wildmatch(line, { pathname: true, caseFold }), negate, dirOnly, basenameOnly });
  }
  return rules;
}

/**
 * Whether `path` (relative to the listing root, forward slashes) is ignored by
 * `rules`, given in precedence order, lowest first. A path whose parent folder
 * is ignored never gets this far: the listing doesn't descend into it, and git
 * can't re-include a file inside an excluded folder either.
 */
export function isIgnored(path: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    if (rule.dirOnly && !isDir) continue;
    let rel: string;
    if (rule.base === '') rel = path;
    else if (path.startsWith(`${rule.base}/`)) rel = path.slice(rule.base.length + 1);
    else continue;
    const subject = rule.basenameOnly ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
    if (rule.match.test(subject)) return !rule.negate;
  }
  return false;
}

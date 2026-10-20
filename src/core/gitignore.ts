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

/** A line `parseIgnore` couldn't compile and left out. `line` counts from 1, comments and blanks included. */
export interface SkippedIgnoreLine {
  line: number;
  /** The line as written, trailing whitespace dropped. */
  pattern: string;
  /** What is wrong with it, in the pattern's terms. */
  reason: string;
  /** What to do about it. */
  fix: string;
}

/**
 * Why a pattern didn't compile, and the fix. The one failure wildmatch has is
 * a reversed range, which arrives as the RegExp engine's complaint about a
 * class the user never wrote (`/^[^z-a/]$/s`), so it's said in the pattern's
 * own terms. Anything else keeps its own words.
 */
function explain(err: Error): { reason: string; fix: string } {
  if (/range out of order/i.test(err.message)) {
    return {
      reason:
        'a range in brackets runs backwards, from a higher character to a lower one. git reads such a range as its first character alone, so a file of that name may be listed here although git ignores it',
      fix: 'Write the range from low to high, as in [a-z], or delete the line.',
    };
  }
  return { reason: err.message, fix: 'Correct the pattern or delete the line.' };
}

/**
 * The `meta.warnings` entry for a skipped line: the file (absolute, forward
 * slashes), the line number, the pattern, why, and what to do. A listing that
 * quietly lists files a `.gitignore` meant to exclude is the failure principle
 * 4 is about, so this is said every time.
 */
export function skippedLineWarning(file: string, skipped: SkippedIgnoreLine): { code: string; message: string } {
  return {
    code: 'GITIGNORE_LINE_SKIPPED',
    message: `Line ${skipped.line} of ${file.replace(/\\/g, '/')} ("${skipped.pattern}") was skipped, and the rest of that file still applies: ${skipped.reason}. ${skipped.fix}`,
  };
}

/**
 * The `meta.warnings` entry for an ignore file that exists but couldn't be
 * read (#264): the file, the error's code and message, what it means for the
 * listing, and what to do. Only a missing file is quietly "no rules"; one that
 * can't be read would otherwise list everything it excludes with nothing to
 * say so (principle 4). A locked filing cabinet is not the same as an empty one.
 */
export function unreadableIgnoreWarning(file: string, err: unknown): { code: string; message: string } {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const detail = err instanceof Error ? err.message : String(err);
  const fix =
    code === 'EACCES' || code === 'EPERM'
      ? "Give your account permission to read it, or delete it if its rules aren't needed."
      : code === 'EBUSY' || code === 'EAGAIN'
        ? 'Close the program holding it locked, then run the command again.'
        : code === 'EISDIR'
          ? 'It is a folder, not a file: rename or remove that folder, and put the rules in a file of that name.'
          : "Make it readable, or delete it if its rules aren't needed.";
  return {
    code: 'GITIGNORE_UNREADABLE',
    // Node's message already starts with the code ("EISDIR: illegal operation on a directory, read").
    message: `${file.replace(/\\/g, '/')} could not be read (${detail}), so none of its rules were applied and files it excludes may be listed. ${fix}`,
  };
}

/**
 * The `meta.warnings` entry for an ignore file that isn't valid UTF-8. Its
 * rules still apply, read with each bad byte replaced by U+FFFD, so the lines
 * that hold one match nothing they were meant to; the ASCII lines around them
 * are unaffected, which is why the file isn't thrown out instead.
 */
export function undecodableIgnoreWarning(file: string): { code: string; message: string } {
  return {
    // Its own code: the file was read and its rules apply, which is not what GITIGNORE_UNREADABLE means.
    code: 'GITIGNORE_NOT_UTF8',
    message: `${file.replace(/\\/g, '/')} is not valid UTF-8. Its rules were read with the bytes that don't decode replaced, so a pattern holding them may not match the files it names, and those files may be listed. Save the file as UTF-8.`,
  };
}

/**
 * Parses one ignore file's text into rules rooted at `base`. A line whose
 * pattern doesn't compile (a reversed range such as `[b-a]`) is left out on
 * its own and handed to `onSkip`; the lines around it still apply, as they do
 * in git, which never discards a whole file over one line. One misfiled form
 * does not cancel the rest of the folder.
 */
export function parseIgnore(text: string, base: string, caseFold = false, onSkip?: (skipped: SkippedIgnoreLine) => void): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n]!;
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
    let match: Wildmatch;
    try {
      match = wildmatch(line, { pathname: true, caseFold });
    } catch (err) {
      onSkip?.({ line: n + 1, pattern: lines[n]!.trimEnd(), ...explain(err as Error) });
      continue;
    }
    rules.push({ base, match, negate, dirOnly, basenameOnly });
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

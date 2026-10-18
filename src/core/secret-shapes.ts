import { isSecretParam, redactUrl } from './http.js';

/**
 * toil's one definition of what a secret looks like in text: the token
 * shapes, the `name=value` pairs, the Authorization values, the URLs with
 * credentials and the long random runs. The audit log redacts with it
 * (`redactText`, src/core/audit.ts), and anything that has to find secrets
 * rather than hide them reads the same rules through `findSecrets`, so the
 * two can't come to disagree about what counts. Two definitions of a secret
 * would need a reconciliation meeting, and the minutes would hold both.
 */

/** A rule that recognises a secret by its shape alone, wherever it appears. */
export interface SecretShape {
  /** Stable id, reported with each finding. */
  id: string;
  pattern: RegExp;
}

/**
 * Tokens recognisable by their shape, wherever they appear. Each match is
 * replaced whole. The order is the order `redactText` applies them in.
 */
export const TOKEN_SHAPES: readonly SecretShape[] = [
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'sonar-token', pattern: /\bsq[uap]_[A-Za-z0-9]{20,}/g },
  { id: 'sk-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { id: 'atlassian-token', pattern: /\bATATT[A-Za-z0-9_=-]{20,}/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
];
/** An Authorization-style value: the scheme word stays, the credential after it goes. */
const AUTH_VALUE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/**
 * Anything else long and random-looking: 24 or more letters, digits, `_`,
 * `+` or `=` in a row, with both a letter and a digit. `/`, `-` and `.` end a
 * run, so URL paths and hyphenated ids stay readable; a base64 token split by
 * a `/` still loses every long piece. A hex run of exactly 40 or 64 is a
 * commit or a digest and stays; every other hex run goes, since some tokens
 * are hex too.
 */
const LONG_RUN = /[A-Za-z0-9_+=]{24,}/g;
const isLongSecret = (run: string) => /[A-Za-z]/.test(run) && /\d/.test(run) && !(/^[0-9a-f]+$/i.test(run) && (run.length === 40 || run.length === 64));
// Every pattern below is bounded or anchored so it runs in linear time: a
// scheme can start only where no scheme character precedes it, and is at
// most 32 long. Regular expressions that backtrack are how an audit trail
// becomes the outage it was meant to record.
const URL_IN_TEXT = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]+/gi;

/**
 * `password=hunter2`, `--password=hunter2`, `Password: "x"`, `Authorization: Bearer abc`, and JSON
 * pasted as text (`{"password":"hunter2"}`, `{'token': 'abc'}`): the name
 * and its quotes stay, the value goes, keeping a quoted value quoted.
 */
const PAIR = /(?<![\w.])(-{0,2})(["']?)([A-Za-z_][\w.-]{0,63})\2(\s{0,8}[=:]\s{0,8})((?:(?:Bearer|Basic|Token)\s{1,8})?(?:"[^"]{0,512}"|'[^']{0,512}'|[^\s;&,"'}\]]{1,512}))/g;
/** `curl -u admin:hunter2`, `-uadmin:hunter2`, `--user admin:hunter2`, `--user=admin:hunter2`. */
const USER_FLAG = /((?:^|\s)(?:-u\s{0,8}|--user[=\s]{1,8}))([^\s:]{1,256}):\S+/g;

/**
 * Names treated as sensitive beyond `--verbose`'s rule, compared lowercased
 * with `-`, `_` and `.` removed: anything with authorization, passphrase,
 * cookie, session, credential or private in it, and `auth` or `pat` alone or
 * at the end (`basicAuth`, `gitlabPat`). `author` stays.
 */
const SENSITIVE_PART = /authorization|passphrase|cookie|session|credential|private/;
const SENSITIVE_END = /(?:auth|pat)$/;

/**
 * Whether a name says its value is a secret: `--verbose`'s rule for query
 * parameters plus the names above, except a bare `key`, which in toil's
 * inputs is an issue, space or project key. A real key passed there is still
 * caught by its shape.
 */
export function secretField(name: string): boolean {
  const n = name.toLowerCase().replace(/[-_.\s]/g, '');
  if (n === 'key') return false;
  return isSecretParam(name) || SENSITIVE_PART.test(n) || SENSITIVE_END.test(n);
}

/** `-p=x` is mysql's password flag; a bare `p` anywhere else is just a letter. */
const pairIsSecret = (dashes: string, name: string) => secretField(name) || (dashes === '-' && name === 'p');

/** A string with every URL redacted as `--verbose` redacts one, and every token-shaped run replaced. */
export function redactText(text: string): string {
  let out = text.replace(URL_IN_TEXT, (url) => redactUrl(url));
  for (const shape of TOKEN_SHAPES) out = out.replace(shape.pattern, '[redacted]');
  out = out.replace(AUTH_VALUE, (_, scheme: string) => `${scheme} [redacted]`);
  out = out.replace(PAIR, (whole, dashes: string, quote: string, name: string, sep: string, value: string) => {
    // Already redacted, scheme and all (`Basic [redacted]`): leave it, so a second pass changes nothing.
    if (!pairIsSecret(dashes, name) || value.includes('[redacted')) return whole;
    const q = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${dashes}${quote}${name}${quote}${sep}${q}[redacted]${q}`;
  });
  out = out.replace(USER_FLAG, (_, flag: string, user: string) => `${flag}${user}:[redacted]`);
  return out.replace(LONG_RUN, (run) => (isLongSecret(run) ? '[redacted]' : run));
}

/** Every rule `findSecrets` can report: the token shapes, then the rules that read context around the value. */
export const SECRET_RULES: readonly string[] = [...TOKEN_SHAPES.map((s) => s.id), 'url-credentials', 'authorization-value', 'name-value', 'user-flag', 'long-random'];

/** Where a secret sits in a string: the secret's own characters, never the name or scheme around it. */
export interface SecretMatch {
  rule: string;
  /** UTF-16 offset of the secret's first character. */
  index: number;
  length: number;
}

/**
 * Every secret the same rules `redactText` applies would hide, by position,
 * read from the original text (redaction reads each rule's output; finding
 * reads the input, so positions stay true). A match lying wholly inside
 * another is dropped, keeping the first by position and then by length. The
 * result is sorted by position.
 */
export function findSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  const add = (rule: string, index: number, length: number) => {
    if (length > 0) found.push({ rule, index, length });
  };
  for (const m of text.matchAll(URL_IN_TEXT)) urlSecrets(m[0], m.index, add);
  for (const shape of TOKEN_SHAPES) for (const m of text.matchAll(shape.pattern)) add(shape.id, m.index, m[0].length);
  for (const m of text.matchAll(AUTH_VALUE)) {
    const token = m[0].replace(/^\S+\s+/, '');
    add('authorization-value', m.index + m[0].length - token.length, token.length);
  }
  for (const m of text.matchAll(PAIR)) {
    const [whole, dashes = '', , name = '', , value = ''] = m;
    if (!pairIsSecret(dashes, name) || value.includes('[redacted')) continue;
    let start = m.index + whole.length - value.length;
    let inner = value;
    const q = inner[0];
    if ((q === '"' || q === "'") && inner.length >= 2 && inner.endsWith(q)) {
      inner = inner.slice(1, -1);
      start += 1;
    }
    const scheme = /^(?:Bearer|Basic|Token)\s+/.exec(inner)?.[0] ?? '';
    add('name-value', start + scheme.length, inner.length - scheme.length);
  }
  for (const m of text.matchAll(USER_FLAG)) {
    const [whole, flag = '', user = ''] = m;
    const offset = flag.length + user.length + 1;
    add('user-flag', m.index + offset, whole.length - offset);
  }
  // redactText looks for long runs last, in text the other rules have already redacted. Blanking
  // what they found, at the same length, gives the same answer at the same positions.
  const blank = text.split('');
  for (const f of found) blank.fill(' ', f.index, f.index + f.length);
  const rest = blank.join('');
  for (const m of rest.matchAll(LONG_RUN)) if (isLongSecret(m[0])) add('long-random', m.index, m[0].length);
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  // Sorted by start, a match lies inside an earlier one exactly when it ends no later than the furthest end so far.
  const kept: SecretMatch[] = [];
  let furthest = -1;
  for (const match of found) {
    const end = match.index + match.length;
    if (end <= furthest) continue;
    kept.push(match);
    furthest = end;
  }
  return kept;
}

/** The userinfo and the credential query values of one URL found in text, as `redactUrl` would hide them. */
function urlSecrets(url: string, at: number, add: (rule: string, index: number, length: number) => void) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.username || parsed.password) {
    const userinfo = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)@/i.exec(url);
    if (userinfo) add('url-credentials', at + userinfo[1]!.length, userinfo[2]!.length);
  }
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return;
  let offset = queryAt + 1;
  for (const part of beforeHash.slice(queryAt + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && isSecretParam(part.slice(0, eq))) add('url-credentials', at + offset + eq + 1, part.length - eq - 1);
    offset += part.length + 1;
  }
}

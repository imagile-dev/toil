// Redaction for issues filed from outside (the feedback form and the curl
// endpoint). The feedback function (functions/feedback/) runs it on a report's
// title and body before it files the issue, so the first revision is already
// redacted; .github/workflows/triage.yml runs it again before any agent reads
// the issue, and writes the result back in the same step. The second pass
// changes nothing unless the denylist has grown since.
//
// It removes, in this order:
//   1. credential-shaped strings → [redacted-secret]: the token shapes in
//      src/core/token-shapes.mjs (the list toil's own redactor reads too), then
//      the Authorization, URL userinfo and key-name rules below
//   2. email addresses, except reserved example domains and GitHub's noreply → [redacted-email]
//   3. denylisted domains and internal hosts (.local, .internal, .corp, .lan,
//      .intranet, .localdomain) → <service>.imagile.dev when the first label names a
//      known service, otherwise redacted.imagile.dev
//   4. private, loopback, link-local and shared-range IPv4 addresses → [redacted-ip]
//   5. denylisted words and patterns → [org]
//
// Before any rule runs, the text is cut to MAX_LENGTH, zero-width and
// direction-control characters are removed, and the rest is NFKC-normalised,
// so a token typed in fullwidth letters or split by an invisible space keeps
// its shape. Every rule is bounded or starts only where its run of characters
// starts, so a 65,536-character body costs about what 65,536 characters of
// prose do.
//
// The denylist comes only from the REDACT_TERMS secret (and, for the feedback
// function, its copy in Key Vault), one entry per line: a word (whole-word,
// any case), a domain (contains a dot; it and its subdomains), or
// `re:/pattern/flags`. Lines starting with # are comments. An entry that would
// match the redactor's own markers is refused, or every run would rewrite the
// last one's output, which is how a filing system ends up filing itself.
// Running it twice changes nothing the second time.
//
// The module imports only node:url and token-shapes.mjs, so the feedback
// function's build can copy the two files into its package at the same
// relative paths and load them as they are.
//
//   node scripts/triage/redact.mjs < {"title","body"}.json   → {"title","body","changed","invalidTerms"}
//   node scripts/triage/redact.mjs --titles < [{"title",…}]     → the same list, titles redacted

import { pathToFileURL } from 'node:url';
import { TOKEN_SHAPES } from '../../src/core/token-shapes.mjs';

const SECRET = '[redacted-secret]';
const EMAIL = '[redacted-email]';
const IP = '[redacted-ip]';
const ORG = '[org]';

/** The longest text redacted; anything after it is dropped first. GitHub's own limit for an issue body. */
export const MAX_LENGTH = 65_536;

export const SERVICES = [
  'ado', 'alation', 'artifactory', 'bitbucket', 'checkmarx', 'confluence', 'contrast', 'dynatrace', 'elasticsearch',
  'figma', 'ghe', 'git', 'github', 'gitlab', 'grafana', 'iq', 'jenkins', 'jira', 'kibana', 'logscale', 'nexus',
  'openshift', 'sde', 'sonar', 'sonarqube', 'splunk', 'tfs',
];

const INTERNAL_TLDS = ['local', 'internal', 'corp', 'lan', 'intranet', 'localdomain'];
const KEEP_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$/i;
// Words in the markers this script writes; a denylist entry matching one is refused.
const OWN_OUTPUT = ['redacted', 'secret', 'email', 'ip', 'org', 'imagile', 'dev', 'imagile.dev', ...SERVICES];
// Zero-width characters, the soft hyphen and the bidirectional controls: invisible, and
// enough to split a token so no shape matches it. A zero-width space right after an @
// stays, because that is the feedback function's mark that keeps a mention from pinging.
const INVISIBLE = /[\u00AD\u180E\u200C-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|(?<!@)\u200B/g;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parses REDACT_TERMS into words, domains and patterns, setting aside entries that would redact the redactor. */
export function parseTerms(raw = '') {
  const terms = { words: [], domains: [], patterns: [], invalid: 0 };
  for (const line of raw.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    if (entry.startsWith('re:')) {
      const match = /^re:\/(.+)\/([a-z]*)$/.exec(entry);
      try {
        if (!match) throw new Error('not re:/pattern/flags');
        const flags = match[2].includes('g') ? match[2] : `${match[2]}g`;
        const probe = new RegExp(match[1], flags.replace('g', ''));
        const markers = [SECRET, EMAIL, IP, ORG, 'redacted.imagile.dev', ...OWN_OUTPUT];
        if (probe.test('') || markers.some((m) => probe.test(m))) throw new Error('matches the redactor output');
        terms.patterns.push(new RegExp(match[1], flags));
      } catch {
        terms.invalid++;
      }
      continue;
    }
    const value = entry.toLowerCase();
    if (OWN_OUTPUT.includes(value) || value.endsWith('.imagile.dev') || !/^[a-z0-9][a-z0-9.-]*$/.test(value)) {
      terms.invalid++;
      continue;
    }
    (value.includes('.') ? terms.domains : terms.words).push(value);
  }
  return terms;
}

const SECRET_PATTERNS = TOKEN_SHAPES.map((shape) => shape.pattern);

const CREDENTIAL = '(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)s?';
// A key name ending in a credential word, read from where its run of name characters starts.
const KEY_NAME = `(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,64}?${CREDENTIAL}`;

function redactSecrets(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, SECRET);
  // Authorization headers.
  out = out.replace(/\b(Bearer|Basic)(\s{1,8})(?!\[redacted)[A-Za-z0-9._~+/=-]{12,}/gi, (_, scheme, space) => `${scheme}${space}${SECRET}`);
  // userinfo in a URL: scheme://user:password@host keeps the scheme and host. A scheme
  // starts where no scheme character precedes it and is at most 32 long.
  out = out.replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)(?!\[redacted)[^\s/@:]+:[^\s/@]+@/gi, (_, scheme) => `${scheme}${SECRET}@`);
  // key=value, key: value and "key": "value" where the key names a credential by its
  // suffix, so TOIL_JIRA_TOKEN=…, "apiToken": "…" and clientSecret: … are all caught.
  out = out.replace(
    new RegExp(`(["']?${KEY_NAME}["']?\\s{0,8}[:=]\\s{0,8})(["']?)(?!\\[redacted)([^\\s"',;]{4,})\\2`, 'gi'),
    (_, key, quote) => `${key}${quote}${SECRET}${quote}`,
  );
  // A credential flag: --token <value>, --password=<value>.
  out = out.replace(/(--(?:token|password|secret|api-key|apikey)(?:=|\s{1,8}))(?!\[redacted)(\S{4,})/gi, (_, flag) => `${flag}${SECRET}`);
  // The positional form: `connections set <name>.<secretKey> <value>` or `config set …`.
  out = out.replace(new RegExp(`(\\bset\\s{1,8}\\S{0,128}?${CREDENTIAL}\\s{1,8})(?!\\[redacted)(\\S+)`, 'gi'), (_, prefix) => `${prefix}${SECRET}`);
  return out;
}

function isInternalHost(host, terms) {
  const lower = host.toLowerCase();
  if (lower === 'imagile.dev' || lower.endsWith('.imagile.dev')) return false;
  return INTERNAL_TLDS.includes(lower.split('.').at(-1)) || terms.domains.some((d) => lower === d || lower.endsWith(`.${d}`));
}

function replacementHost(host) {
  const first = host.toLowerCase().split('.')[0];
  return SERVICES.includes(first) ? `${first}.imagile.dev` : 'redacted.imagile.dev';
}

/** One pattern for every denylisted word, built once per text rather than once per address. */
const wordPattern = (terms) => (terms.words.length ? new RegExp(`(^|[^a-z0-9])(?:${terms.words.map(escapeRegex).join('|')})([^a-z0-9]|$)`, 'i') : null);

function redactEmails(text, terms) {
  const words = wordPattern(terms);
  // The local part starts where its run starts and is at most 64 long, the most an address allows.
  return text.replace(/(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g, (whole, user, domain) => {
    if (words?.test(whole) || isInternalHost(domain, terms)) return EMAIL;
    // git@host is an SSH remote, not a person.
    if (user.toLowerCase() === 'git') return whole;
    return KEEP_EMAIL_DOMAINS.test(domain) ? whole : EMAIL;
  });
}

function redactHosts(text, terms) {
  // A host starts where its run of host characters starts, so a long dotted run is read once, not once per label.
  return text.replace(/(?<![A-Za-z0-9.-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{1,62})\b/g, (host) =>
    isInternalHost(host, terms) ? replacementHost(host) : host,
  );
}

const isPrivate = (a, b) => a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);

function redactIps(text) {
  return text.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (whole, ...parts) => {
    const [a, b, c, d] = parts.slice(0, 4).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return whole;
    return isPrivate(a, b) ? IP : whole;
  });
}

function redactWords(text, terms) {
  let out = text;
  for (const word of terms.words) out = out.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(word)}(?=[^A-Za-z0-9]|$)`, 'gi'), (_, before) => `${before}${ORG}`);
  for (const pattern of terms.patterns) out = out.replace(pattern, ORG);
  return out;
}

/**
 * Whether a text holds a token by its shape alone: the prefixed formats, JWTs
 * and private keys in TOKEN_SHAPES, never the key-name rules, which flag
 * ordinary code such as `token: z.string()`. What the triage workflow checks
 * every agent-written text and every added line for before posting any of it;
 * a `/proc/self/environ` dump is caught because every token it could hold has
 * a known prefix.
 */
export function tokenShaped(text) {
  if (typeof text !== 'string' || text === '') return false;
  return SECRET_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text));
}

/**
 * The text the rules read: at most MAX_LENGTH long (never ending in half a
 * surrogate pair), with invisible characters removed, then NFKC-normalised.
 * Removing them before normalising means a second pass finds nothing new.
 */
export function normalize(text) {
  let out = text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH) : text;
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out.replace(INVISIBLE, '').normalize('NFKC');
}

/** Redacts one string with terms from parseTerms(). */
export function redact(text, terms = parseTerms('')) {
  if (typeof text !== 'string' || text === '') return '';
  return redactWords(redactIps(redactHosts(redactEmails(redactSecrets(normalize(text)), terms), terms)), terms);
}

// CLI: JSON {title, body} on stdin, REDACT_TERMS in env, JSON out. The terms
// never reach stdout, a log line or argv.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const terms = parseTerms(process.env.REDACT_TERMS ?? '');
  // --titles: a JSON array of issues in, the same array out with each title redacted.
  if (process.argv.includes('--titles')) {
    process.stdout.write(`${JSON.stringify(input.map((issue) => ({ ...issue, title: redact(issue.title ?? '', terms) })), null, 1)}
`);
    process.exit(0);
  }
  const title = redact(input.title ?? '', terms);
  const body = redact(input.body ?? '', terms);
  const changed = title !== (input.title ?? '') || body !== (input.body ?? '');
  process.stdout.write(`${JSON.stringify({ title, body, changed, invalidTerms: terms.invalid })}\n`);
}

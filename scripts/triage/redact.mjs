// Redaction for issues filed from outside (the feedback form and the curl
// endpoint), run by .github/workflows/triage.yml on the title and body before
// any agent reads them, and written back to the issue in the same step.
//
// It removes, in this order:
//   1. credential-shaped strings → [redacted-secret]
//   2. email addresses, except reserved example domains and GitHub's noreply → [redacted-email]
//   3. denylisted domains and internal hosts (.local, .internal, .corp, .lan,
//      .intranet, .localdomain) → <service>.imagile.dev when the first label names a
//      known service, otherwise redacted.imagile.dev
//   4. private, loopback, link-local and shared-range IPv4 addresses → [redacted-ip]
//   5. denylisted words and patterns → [org]
//
// The denylist comes only from the REDACT_TERMS secret, one entry per line: a
// word (whole-word, any case), a domain (contains a dot; it and its
// subdomains), or `re:/pattern/flags`. Lines starting with # are comments. An
// entry that would match the redactor's own markers is refused, or every run
// would rewrite the last one's output, which is how a filing system ends up
// filing itself. Running it twice changes nothing the second time.
//
//   node scripts/triage/redact.mjs < {"title","body"}.json   → {"title","body","changed","invalidTerms"}
//   node scripts/triage/redact.mjs --titles < [{"title",…}]     → the same list, titles redacted

import { pathToFileURL } from 'node:url';

const SECRET = '[redacted-secret]';
const EMAIL = '[redacted-email]';
const IP = '[redacted-ip]';
const ORG = '[org]';

export const SERVICES = [
  'ado', 'alation', 'artifactory', 'bitbucket', 'checkmarx', 'confluence', 'contrast', 'dynatrace', 'elasticsearch',
  'figma', 'ghe', 'git', 'github', 'gitlab', 'grafana', 'iq', 'jenkins', 'jira', 'kibana', 'logscale', 'nexus',
  'openshift', 'sde', 'sonar', 'sonarqube', 'splunk', 'tfs',
];

const INTERNAL_TLDS = ['local', 'internal', 'corp', 'lan', 'intranet', 'localdomain'];
const KEEP_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$/i;
// Words in the markers this script writes; a denylist entry matching one is refused.
const OWN_OUTPUT = ['redacted', 'secret', 'email', 'ip', 'org', 'imagile', 'dev', 'imagile.dev', ...SERVICES];

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

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bATATT[A-Za-z0-9_\-=]{20,}/g,
  /\bBBDC-[A-Za-z0-9+/_-]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

const KEY_NAME = '[A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)s?';

function redactSecrets(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, SECRET);
  // Authorization headers.
  out = out.replace(/\b(Bearer|Basic)(\s+)(?!\[redacted)[A-Za-z0-9._~+/=-]{12,}/gi, (_, scheme, space) => `${scheme}${space}${SECRET}`);
  // userinfo in a URL: scheme://user:password@host keeps the scheme and host.
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)(?!\[redacted)[^\s/@:]+:[^\s/@]+@/gi, (_, scheme) => `${scheme}${SECRET}@`);
  // key=value, key: value and "key": "value" where the key names a credential by its
  // suffix, so TOIL_JIRA_TOKEN=…, "apiToken": "…" and clientSecret: … are all caught.
  out = out.replace(
    new RegExp(`(["']?${KEY_NAME}["']?\\s*[:=]\\s*)(["']?)(?!\\[redacted)([^\\s"',;]{4,})\\2`, 'gi'),
    (_, key, quote) => `${key}${quote}${SECRET}${quote}`,
  );
  // A credential flag: --token <value>, --password=<value>.
  out = out.replace(/(--(?:token|password|secret|api-key|apikey)(?:=|\s+))(?!\[redacted)(\S{4,})/gi, (_, flag) => `${flag}${SECRET}`);
  // The positional form: `connections set <name>.<secretKey> <value>` or `config set …`.
  out = out.replace(new RegExp(`(\\bset\\s+\\S*${KEY_NAME}\\s+)(?!\\[redacted)(\\S+)`, 'gi'), (_, prefix) => `${prefix}${SECRET}`);
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

const hasWord = (text, terms) => terms.words.some((w) => new RegExp(`(^|[^a-z0-9])${escapeRegex(w)}([^a-z0-9]|$)`, 'i').test(text));

function redactEmails(text, terms) {
  return text.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g, (whole, user, domain) => {
    if (hasWord(whole, terms) || isInternalHost(domain, terms)) return EMAIL;
    // git@host is an SSH remote, not a person.
    if (user.toLowerCase() === 'git') return whole;
    return KEEP_EMAIL_DOMAINS.test(domain) ? whole : EMAIL;
  });
}

function redactHosts(text, terms) {
  return text.replace(/\b((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{1,62})\b/g, (host) =>
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
 * Whether a text holds anything credential-shaped (step 1 above): what the
 * triage workflow checks every agent-written text and every added line for
 * before posting any of it.
 */
export function secretShaped(text) {
  return typeof text === 'string' && text !== '' && redactSecrets(text) !== text;
}

/** Redacts one string with terms from parseTerms(). */
export function redact(text, terms = parseTerms('')) {
  if (typeof text !== 'string' || text === '') return '';
  return redactWords(redactIps(redactHosts(redactEmails(redactSecrets(text), terms), terms)), terms);
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

// A report is redacted here, before its issue is created, with the same module
// and rules triage runs (scripts/triage/redact.mjs), so the issue's first
// revision, and the notices that quote it, never hold what triage would have
// removed. Triage still redacts again; the module is idempotent, so its pass
// changes nothing unless the denylist has grown since.
//
// The build copies redact.mjs and the token shapes it reads into dist/ at the
// same relative paths (scripts/copy-shared.mjs), so the import below resolves
// in the deployed package exactly as it does in the repository.
//
// The organization denylist reaches the app as REDACT_TERMS, a Key Vault
// reference to FEEDBACK-REDACT-TERMS, the function's copy of the REDACT_TERMS
// repository secret, which can't be read back. With it empty or unresolved,
// the built-in rules (secrets, internal hosts, private IPs) still apply,
// exactly as they do in triage. Two copies of one list is a reconciliation
// meeting waiting to be scheduled, which is why the comment says where both live.

import { parseTerms, redact, type Terms } from '../../../../scripts/triage/redact.mjs';

/** What an app setting holds when App Service couldn't resolve its Key Vault reference. */
const UNRESOLVED = /^@Microsoft\.KeyVault\(/i;

export interface Redaction {
  terms: Terms;
  /** Why the denylist isn't fully in force, for the log; undefined when it is (or is deliberately empty). */
  warning: string | undefined;
}

/**
 * The denylist from REDACT_TERMS. A Key Vault reference that didn't resolve
 * counts as empty and says so. A value with no line breaks but literal `\n`
 * sequences is read as one entry per `\n`, because that is how a multi-line
 * value often survives a trip through a portal text box.
 */
export function redactionFor(raw: string | undefined): Redaction {
  const value = raw?.trim() ?? '';
  if (UNRESOLVED.test(value)) {
    return {
      terms: parseTerms(''),
      warning: 'REDACT_TERMS is a Key Vault reference that did not resolve (is FEEDBACK-REDACT-TERMS in the vault?), so reports are redacted with the built-in rules only.',
    };
  }
  const terms = parseTerms(/[\r\n]/.test(value) ? value : value.replace(/\\n/g, '\n'));
  const warning = terms.invalid ? `${terms.invalid} REDACT_TERMS entries were refused (they would match the redactor's own markers, or aren't valid).` : undefined;
  return { terms, warning };
}

/** A report's title and body as they may appear on a public issue. */
export function redactReport(report: { title: string; body: string }, terms: Terms): { title: string; body: string } {
  return { title: redact(report.title, terms), body: redact(report.body, terms) };
}

export { parseTerms, redact, type Terms };

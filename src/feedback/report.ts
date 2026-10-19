import { ToilError } from '../core/errors.js';
import { CONSENT_VERSION, DISCLAIMER } from './consent.js';

/**
 * The feedback report, built exactly as `toil feedback` sends it: the
 * caller's fields, cleaned and checked the way the endpoint cleans and checks
 * them (functions/feedback/src/lib/handlers.ts), plus toil's version and
 * commit. No dependency but ToilError, so Toil UI's sample preview builds
 * the same report from the same code. One form, filled in once, by the
 * person whose name is on it.
 */

export const KINDS = ['bug', 'feature'] as const;
export type Kind = (typeof KINDS)[number];

/** The limits /api/report applies (functions/feedback/src/lib/handlers.ts), checked here so a preview fails the same way. */
export const MAX_TITLE = 120;
export const MAX_BODY = 4000;
const MAX_EMAIL = 254;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** What /api/report receives, field for field. */
export interface FeedbackReport {
  kind: Kind;
  title: string;
  body: string;
  email: string;
  consent: number;
  version: string;
  commit: string | null;
}

/** The report exactly as it would be sent: the caller's fields, cleaned as the endpoint cleans them, plus toil's version and commit. */
export function buildReport(fields: { kind?: string | undefined; title?: string | undefined; body?: string | undefined; email?: string | undefined }, version: string, commit: string | null): FeedbackReport {
  const { kind } = fields;
  if (kind !== 'bug' && kind !== 'feature') {
    throw new ToilError('INVALID_INPUT', kind === undefined ? 'Say what kind of report this is: bug or feature.' : `The kind must be bug or feature, not ${JSON.stringify(kind)}.`, {
      fix: 'Run toil feedback bug … for something broken, or toil feedback feature … for something you need.',
    });
  }
  const title = (fields.title ?? '').replace(CONTROL, ' ').trim();
  if (title.length < 1 || title.length > MAX_TITLE) {
    throw new ToilError('INVALID_INPUT', `The title must be 1 to ${MAX_TITLE} characters; it is ${title.length}.`, { fix: 'Pass a one-line summary with --title.' });
  }
  const body = (fields.body ?? '').replace(/\r\n?/g, '\n').trim();
  if (body.length < 1 || body.length > MAX_BODY) {
    throw new ToilError('INVALID_INPUT', `The body must be 1 to ${MAX_BODY} characters; it is ${body.length}.`, {
      fix: 'Pass the details with --body, or as "body" in a JSON file given with --input-file.',
    });
  }
  const email = (fields.email ?? '').trim();
  if (email.length > MAX_EMAIL || !EMAIL.test(email)) {
    throw new ToilError('INVALID_INPUT', email ? `${JSON.stringify(email)} isn't an email address.` : 'An email address is needed.', {
      fix: 'Pass yours with --email. It stays private: it is used only to tell you when the issue is filed and when it closes.',
    });
  }
  return { kind, title, body, email, consent: CONSENT_VERSION, version, commit };
}

/** The report and the disclaimer, as a terminal (or a host's dialog) shows them before asking. */
export function previewText(endpoint: string, report: FeedbackReport): string {
  return `toil would send this to ${endpoint}:\n${JSON.stringify(report, null, 2)}\n\n${DISCLAIMER}\n\nSend this report to Imagile LLC? Type yes to send it`;
}


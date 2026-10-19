/**
 * The Feedback dialog's sample, for the site preview and `toil-ui --sample`:
 * the report built by toil's own code (src/feedback/report.ts), so the preview
 * shows what `toil feedback` would send, and a send that is refused, saying
 * why. Nothing here reaches any network. A suggestion box with a slot and no
 * bottom, labelled as such.
 */

import { ToilError } from '../../../src/core/errors.ts';
import { CONSENT_VERSION, DISCLAIMER, FEEDBACK_ENDPOINT } from '../../../src/feedback/consent.ts';
import { buildReport } from '../../../src/feedback/report.ts';
import { FEEDBACK_SAMPLE_DISABLED, type FeedbackApi, type FeedbackFields } from '../feedback.ts';
import type { Envelope } from '../toil.ts';

const VERSION = '0.1.0-alpha.1';
/** A placeholder commit: the sample isn't a build. */
const COMMIT = 'abc1234500000000000000000000000000000000';

const meta = { command: 'feedback', durationMs: 0, version: VERSION, contractVersion: 1 };

/** `toil feedback`'s envelope for these fields, read-only: the preview, or toil's own refusal of a field. */
export function fixtureFeedbackEnvelope(fields: Record<string, unknown>, send: boolean): Envelope {
  try {
    const str = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : undefined);
    const report = buildReport({ kind: str('kind'), title: str('title'), body: str('body'), email: str('email') }, VERSION, COMMIT);
    if (send) return { ok: false, data: null, error: { code: 'INVALID_INPUT', message: 'Nothing was sent: this is sample data.', fix: FEEDBACK_SAMPLE_DISABLED }, meta } as Envelope;
    const data = { sent: false, endpoint: FEEDBACK_ENDPOINT, report, consentVersion: CONSENT_VERSION, disclaimer: DISCLAIMER, approve: 'Tick the box once you have read the report and the disclaimer.' };
    return { ok: true, data, error: null, meta: { ...meta, warnings: [{ code: 'FEEDBACK_NOT_SENT', message: 'Nothing was sent: this is a preview.' }] } } as Envelope;
  } catch (e) {
    const error = e instanceof ToilError ? { code: e.code, message: e.message, ...(e.fix ? { fix: e.fix } : {}) } : { code: 'INTERNAL', message: String(e) };
    return { ok: false, data: null, error, meta } as Envelope;
  }
}

export function fixtureFeedback(): FeedbackApi {
  return {
    disabled: FEEDBACK_SAMPLE_DISABLED,
    preview: async (fields: FeedbackFields) => fixtureFeedbackEnvelope({ ...fields }, false),
    send: async (fields: FeedbackFields) => fixtureFeedbackEnvelope({ ...fields }, true),
  };
}

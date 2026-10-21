/**
 * The page's side of the assignment routes (ui/server/assign/routes.ts),
 * over the session every other call uses. The page sends ids, never a
 * command: applying a proposal names the assignment and the proposal, and
 * the server runs what it stored. Each method throws with the server's
 * message and fix. Correspondence by reference number only.
 */

import { AnswerError, type Session } from '../server-client.ts';
import type { AnswerUsage } from '../model-usage.ts';
import type { Assignment, AssignmentList, AssignmentRecord, AssignmentsApi, AssignSettings } from './model.ts';

const SESSION_HEADER = 'X-Toil-UI-Session';
const CSRF_HEADER = 'X-Toil-UI-CSRF';

async function failure(res: Response, what: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string; fix?: string; usage?: AnswerUsage } };
    if (body.error?.message) return new AnswerError(`${body.error.message}${body.error.fix ? ` ${body.error.fix}` : ''}`, body.error.usage);
  } catch {
    // Not JSON: fall through to the status.
  }
  return new Error(`${what} failed: the server answered ${res.status}.`);
}

/** Why a session can't assign: a server that keeps no assignments. */
export const NO_ASSIGNMENTS = 'This Toil UI assigns nothing: start toil-ui with its cache to assign items to an agent.';

export function httpAssignments(session: Session & { assignments?: boolean }, base = './'): AssignmentsApi {
  const call = async <T,>(path: string, what: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${base}api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      headers: { [SESSION_HEADER]: session.session, ...(body === undefined ? {} : { 'Content-Type': 'application/json', [CSRF_HEADER]: session.csrf }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await failure(res, what);
    return (await res.json()) as T;
  };
  return {
    disabled: session.assignments ? null : NO_ASSIGNMENTS,
    list: (dossier) => call<AssignmentList>(`assignments?dossier=${encodeURIComponent(dossier)}`, 'Reading the assignments'),
    get: (id) => call<AssignmentRecord>(`assignments/one?id=${encodeURIComponent(id)}`, 'Reading the assignment'),
    assign: (request) => call<Assignment>('assignments', 'Assigning the item', request),
    start: (id, adapter) => call<Assignment>('assignments/start', 'Starting the assignment', { id, ...(adapter ? { adapter } : {}) }),
    cancel: (id) => call<Assignment>('assignments/cancel', 'Stopping the assignment', { id }),
    apply: (id, proposal) => call<Assignment>('assignments/apply', 'Applying the proposal', { id, proposal }),
    dismiss: (id, proposal) => call<Assignment>('assignments/dismiss', 'Dismissing the proposal', { id, proposal }),
    finish: (id) => call<Assignment>('assignments/finish', 'Marking it reviewed', { id }),
    renew: (id) => call<Assignment>('assignments/renew', 'Renewing the assignment', { id }),
    ...(session.sample ? {} : { saveSettings: (settings: AssignSettings) => call<AssignSettings>('assignments/settings', 'Saving the limits', { concurrent: settings.concurrent, timeLimitMinutes: settings.timeLimitMinutes }) }),
  };
}

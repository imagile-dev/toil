import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Progress events: what a long command is doing while it runs, for a caller
 * that wants to show it (a sync's progress bar, a person at a terminal). They
 * never change the result: the envelope is the same with or without a
 * listener, and nothing in them is a header, a body or a credential.
 *
 * Core reports them, never an area. execute() runs each command inside
 * `withProgress`, and the shared machinery (the paging loop, the 429 retry,
 * the instrumented fetch) calls `reportProgress`, which finds the listener
 * through AsyncLocalStorage. An area that pages through `paginate()` or sends
 * through `restRequest` reports progress without a line of its own, which is
 * the only way a status report has ever been filed on time.
 */

/** One HTTP request finished: its method, redacted URL, status (null when it failed to answer) and time. */
export interface RequestProgress {
  type: 'request';
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
}

/** One page of a paged listing was read: its number in this call (from 1), and the items read so far, this page's included. */
export interface PageProgress {
  type: 'page';
  page: number;
  items: number;
  /** What is being listed, when the command said ("Jira sprints for board 7"). */
  what?: string;
}

/** A 429 is being retried: the attempt that was refused, how long toil waits before the next, and the redacted URL. */
export interface RetryProgress {
  type: 'retry';
  attempt: number;
  waitMs: number;
  status: number;
  url: string;
}

/** What core reports, before execute() adds the command and the message. */
export type ProgressBody = RequestProgress | PageProgress | RetryProgress;

/** A progress event as a listener gets it: the command it belongs to, and one line saying it in words. */
export type ProgressEvent = ProgressBody & { command: string; message: string };

const listener = new AsyncLocalStorage<(body: ProgressBody) => void>();

/** Runs `fn` with `report` as the listener for everything it reports, however deep. */
export function withProgress<T>(report: (body: ProgressBody) => void, fn: () => Promise<T>): Promise<T> {
  return listener.run(report, fn);
}

/** Reports one event to the listener of the command running, if there is one. Never throws. */
export function reportProgress(body: ProgressBody): void {
  listener.getStore()?.(body);
}

/** The line a person reads for an event, on stderr or in an MCP progress notification. */
export function progressMessage(command: string, body: ProgressBody): string {
  switch (body.type) {
    case 'request':
      return `${command}: ${body.method} ${body.url} -> ${body.status ?? 'no answer'} in ${body.durationMs} ms`;
    case 'page':
      return `${command}: read page ${body.page}${body.what ? ` of ${body.what}` : ''}, ${body.items} item${body.items === 1 ? '' : 's'} so far`;
    case 'retry':
      return `${command}: rate limited (${body.status}) on ${body.url}; retrying in ${Math.round(body.waitMs / 100) / 10} s (attempt ${body.attempt + 1})`;
  }
}

/** Whether a front door shows the event to a person. Requests are --verbose's and --debug's to show; pages and retries are progress. */
export const shownToPeople = (event: ProgressEvent): boolean => event.type !== 'request';

/**
 * The CLI's listener: one plain `[toil] …` line on stderr per event worth a
 * person's attention, never stdout. A retry is always said, piped or not,
 * because a run that waits a minute in silence looks hung (principle 4). A
 * page is said only on a terminal, where someone is watching; a pipe, usually
 * an agent, isn't sent a line per page.
 */
export function cliProgress(stderr: { isTTY?: boolean; write: (text: string) => unknown }): (event: ProgressEvent) => void {
  return (event) => {
    if (event.type === 'retry' || (event.type === 'page' && stderr.isTTY === true)) stderr.write(`[toil] ${event.message}\n`);
  };
}

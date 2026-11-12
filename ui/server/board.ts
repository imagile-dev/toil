/**
 * The Board's server (#566 follow-up): a person dropped a card on another
 * column, and this runs the one toil command that makes the move, as that
 * person, behind the connection's `writes` setting. The page names a Toil
 * project, an item's OWI id and a column. It never sends a command, a
 * connection, a path or a transition: those are worked out here, from toil.
 *
 * - **Who may be moved.** The Toil project must be one `projects list` knows,
 *   the item's connection one `connections list` knows, and the item one the
 *   tracker has (`jira issue get` / `ado work-item get`, which also says which
 *   connection toil picks for that Toil project: it must be the item's own, so
 *   a second Jira never has one issue's key moved on another's site).
 * - **What runs.** Jira: `jira issue transition --to <intent>`. Azure DevOps:
 *   `ado work-item transition --to <intent>`. The intent is the column's
 *   (`MOVE_INTENT`), which toil resolves against that item's own workflow and
 *   refuses, listing the moves it does offer, unless exactly one fits. A
 *   refusal like that is not a failure: nothing was sent, and the page shows
 *   the proposal with those moves. Nothing here picks a transition for anyone.
 * - **What stays a proposal.** A connection with `writes` off, an area with no
 *   status command here (a GitHub project board's Status has no category to
 *   choose by), and every move in the sample. The connection's `writes`
 *   decides, as it would typed by hand, and a toil project's unadopted binding
 *   is refused by toil itself (`WRITE_DISABLED`, with its fix).
 *
 * The call is `caller: 'toil-ui'` through toil's `execute()`, so toil's audit
 * log records it; this file keeps none of its own. A drop is a change request
 * with a signature, and the signature is the drop.
 */

import { MOVE_INTENT, SAMPLE_MOVE, type MoveColumn, type MoveOutcome } from '../src/board-api.ts';
import type { Envelope, Execute } from '../src/toil.ts';
import { CALLER } from './store.ts';

/** A refusal in the words the page shows: what happened, and what to do. */
export class BoardRefusal extends Error {
  constructor(message: string, readonly fix: string, readonly status = 400) {
    super(message);
  }
}

/** What `api/board/move` calls: the service, or the sample's refusal of it. */
export interface BoardBackend {
  move(toilProject: string, item: string, to: MoveColumn, signal: AbortSignal): Promise<MoveOutcome>;
}

export interface BoardServiceOptions {
  execute: Execute;
}

/** An OWI id is `<connection>:<key>`; connection names are lowercase letters, digits and single hyphens. */
const ITEM_ID = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([^\s:][^\s]{0,199})$/;

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export class BoardService implements BoardBackend {
  /** Items with a move in flight: a second drop on the same card waits for the first. */
  private readonly busy = new Set<string>();

  constructor(private readonly o: BoardServiceOptions) {}

  private call(command: string, input: Record<string, unknown>, how: { write?: boolean; signal?: AbortSignal } = {}): Promise<Envelope> {
    return this.o.execute(command, input, { readOnly: how.write !== true, caller: CALLER, ...(how.signal ? { signal: how.signal } : {}) });
  }

  async move(toilProject: string, item: string, to: MoveColumn, signal: AbortSignal): Promise<MoveOutcome> {
    const id = ITEM_ID.exec(item);
    if (!id) throw new BoardRefusal('That is not the id of a work item.', 'Send the OWI id the board shows, such as corp-jira:PAY-102.');
    const [, connection, key] = id as unknown as [string, string, string];
    if (this.busy.has(item)) throw new BoardRefusal(`${key} is already being moved.`, 'Wait for that move to finish; the board shows what came of it.', 409);
    this.busy.add(item);
    try {
      return await this.run(toilProject, item, connection, key, to, signal);
    } finally {
      this.busy.delete(item);
    }
  }

  private async run(toilProject: string, item: string, connection: string, key: string, to: MoveColumn, signal: AbortSignal): Promise<MoveOutcome> {
    const listed = await this.call('projects list', {}, { signal });
    if (!listed.ok) throw new BoardRefusal(`toil couldn't list the Toil projects: ${listed.error.message}`, listed.error.fix ?? 'Fix that, then try again.');
    const known = ((asRecord(listed.data).toilProjects as Array<{ name?: unknown }> | undefined) ?? []).some((p) => p.name === toilProject);
    if (!known) throw new BoardRefusal(`There is no Toil project named ${toilProject}.`, 'Name one of the Toil projects the app lists.', 404);

    const conns = await this.call('connections list', {}, { signal });
    if (!conns.ok) throw new BoardRefusal(`toil couldn't list the connections: ${conns.error.message}`, conns.error.fix ?? 'Fix that, then try again.');
    const row = ((asRecord(conns.data).connections as Array<{ name?: unknown; area?: unknown; writes?: unknown }> | undefined) ?? []).find((c) => c.name === connection);
    if (!row) throw new BoardRefusal(`There is no connection named ${connection}, which ${item} belongs to.`, 'Reload the page; the item may come from a connection that was removed.', 404);

    const area = String(row.area);
    const family = area.split('-')[0];
    if (family !== 'jira' && family !== 'ado') {
      return { status: 'proposal', why: 'unsupported', reason: `Toil UI applies Jira and Azure DevOps moves itself. A ${area} Status is set with its command, which the proposal shows.` };
    }
    // `ado work-item` takes the number; a key that isn't one is not an Azure DevOps work item.
    if (family === 'ado' && !/^\d+$/.test(key)) throw new BoardRefusal(`${key} is not an Azure DevOps work item number.`, 'Reload the page; the item id looks wrong.');

    // The tracker's own copy: it must exist, and toil must reach it through this item's connection.
    const read = family === 'jira' ? await this.call(`${area} issue get`, { toilProject, key }, { signal }) : await this.call(`${area} work-item get`, { toilProject, id: Number(key) }, { signal });
    if (!read.ok) throw new BoardRefusal(`${key} couldn't be read from ${connection}: ${read.error.message}`, read.error.fix ?? 'Check the item is still there, then try again.', read.error.code === 'NOT_FOUND' ? 404 : 400);
    const used = (read.meta as { context?: { connection?: { value?: unknown } } }).context?.connection?.value;
    if (used !== connection) {
      return { status: 'proposal', why: 'unsupported', reason: `For ${toilProject}, toil would use ${typeof used === 'string' ? used : 'another connection'} rather than ${connection}, which ${key} belongs to, so Toil UI leaves the move to you.` };
    }

    if (row.writes !== true) {
      return { status: 'proposal', why: 'writes-off', reason: `Changes to ${connection} are switched off, so this move wasn't applied. Turn them on under Settings, Connections, or apply the proposal yourself.` };
    }

    const input = family === 'jira' ? { toilProject, key, to: MOVE_INTENT[to], allowWrite: true } : { toilProject, id: Number(key), to: MOVE_INTENT[to], allowWrite: true };
    const done = await this.call(family === 'jira' ? `${area} issue transition` : `${area} work-item transition`, input, { write: true, signal });
    if (done.ok) {
      const t = (done.meta as { transition?: { transition?: unknown; toStatus?: unknown } }).transition;
      return { status: 'applied', transition: typeof t?.transition === 'string' ? t.transition : null, toStatus: typeof t?.toStatus === 'string' ? t.toStatus : null };
    }
    // toil resolves the intent against the item's own workflow before it sends anything, and refuses (INVALID_INPUT) when it is already there, when no move leads there or when several do, listing the moves. Nothing was changed.
    if (done.error.code === 'INVALID_INPUT') {
      return { status: 'proposal', why: 'choices', reason: done.error.message, ...(done.error.fix ? { detail: done.error.fix } : {}) };
    }
    // A write that timed out or was cancelled may still have been applied; toil's own message says to check before retrying, and so does this one.
    throw new BoardRefusal(done.error.message, done.error.fix ?? 'Check the tracker before trying again.', done.error.code === 'WRITE_DISABLED' ? 403 : 502);
  }
}

/** The sample's backend for `toil-ui --sample`: every move is a proposal, because the sample writes nothing. */
export function sampleBoard(): BoardBackend {
  return { move: async () => SAMPLE_MOVE };
}

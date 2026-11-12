/**
 * The Board's server (#566 follow-up): a person dropped a card on another
 * column, and this runs the one toil command that makes the move, as that
 * person, behind the connection's `writes` setting. The page names a Toil
 * project, an item's OWI id and a column. It never sends a command, a
 * connection, a path or a transition: those are worked out here, from toil.
 *
 * - **Who may be moved.** The Toil project must be one `projects list` knows,
 *   the item's connection one `connections list` knows, and the item one the
 *   tracker has (`jira issue get` / `ado work-item get` / `github issue get`,
 *   which also say which connection toil picks for that Toil project: it must
 *   be the item's own, so a second Jira never has one issue's key moved on
 *   another's site). A GitHub item's owner, repository and number come from
 *   its own id, parsed strictly (`owner/repo#n`), never from the page's body.
 * - **What runs.** Jira: `jira issue transition --to <intent>`. Azure DevOps:
 *   `ado work-item transition --to <intent>`. The intent is the column's
 *   (`MOVE_INTENT`), which toil resolves against that item's own workflow and
 *   refuses, listing the moves it does offer, unless exactly one fits. A
 *   refusal like that is not a failure: nothing was sent, and the page shows
 *   the proposal with those moves. Nothing here picks a transition for anyone.
 * - **GitHub, on a project board.** When the Toil project names a GitHub
 *   project, a card's column is its Status option, mapped to a category by
 *   toil's own table (`GITHUB_STATUSES`, the one `mapOwi` reads). The server
 *   finds the item on the board (`github project items`), reads the project's
 *   Status options (`github project fields`) and keeps those the table puts in
 *   the column dropped on. Exactly one: `github project status --item <id> --to
 *   <option>`. None, or several: a proposal naming them, because nothing here
 *   picks an option for anyone either. A closed issue stays in Done whatever its
 *   Status says, so moving one out of Done is left to the person.
 * - **GitHub, with no board.** The column is open or closed, and only those are
 *   moves: to Done is `github issue close`, back to To do is `github issue
 *   reopen`. GitHub issues have no In progress, and a pull request is not a
 *   board move (closing it is not finishing it, and merging is its own command),
 *   so both stay proposals, with the reason.
 * - **What stays a proposal.** A connection with `writes` off, an area with no
 *   status command here, and every move in the sample. The connection's
 *   `writes` decides, as it would typed by hand, and a toil project's unadopted
 *   binding is refused by toil itself (`WRITE_DISABLED`, with its fix).
 *
 * The call is `caller: 'toil-ui'` through toil's `execute()`, so toil's audit
 * log records it; this file keeps none of its own. A drop is a change request
 * with a signature, and the signature is the drop. The board it moves a card
 * across is a spreadsheet of record that agreed to be read.
 */

import { GITHUB_STATUSES, GITHUB_STATUS_FIELD } from '../../src/core/owi/github.ts';
import { MOVE_INTENT, SAMPLE_MOVE, type MoveColumn, type MoveOutcome } from '../src/board-api.ts';
import { githubRepos } from '../src/github-repos.ts';
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

/** A GitHub item's key as the OWI mapper forms it: `owner/repo#number`. Strict, since it names what a write is sent to. */
const GITHUB_KEY = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})#([1-9]\d{0,8})$/;

/** A column in the words a sentence uses. */
const COLUMN_WORD: Record<MoveColumn, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

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
    if (family === 'github') return this.github(toilProject, connection, key, to, row.writes === true, signal);
    if (family !== 'jira' && family !== 'ado') {
      return { status: 'proposal', why: 'unsupported', reason: `Toil UI applies Jira, Azure DevOps and GitHub moves itself. toil has no status change for ${area} items.` };
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

  /** A toil refusal of a read: what failed, and the fix toil gave. */
  private readFailure(what: string, env: Extract<Envelope, { ok: false }>): BoardRefusal {
    return new BoardRefusal(`${what}: ${env.error.message}`, env.error.fix ?? 'Check the item is still there, then try again.', env.error.code === 'NOT_FOUND' ? 404 : 400);
  }

  /** A GitHub card: a project Status when the Toil project names a board, else open or closed. */
  private async github(toilProject: string, connection: string, key: string, to: MoveColumn, writesOn: boolean, signal: AbortSignal): Promise<MoveOutcome> {
    const parsed = GITHUB_KEY.exec(key);
    if (!parsed || parsed[2] === '.' || parsed[2] === '..') throw new BoardRefusal(`${key} is not a GitHub issue or pull request.`, 'Reload the page; the item id looks wrong. It should read owner/repo#number.');
    const [, owner, repo, number] = parsed as unknown as [string, string, string, string];
    const n = Number(number);

    // The tracker's own copy: it must exist, and toil must reach it through this item's connection.
    const read = await this.call('github issue get', { toilProject, owner, repo, number: [n] }, { signal });
    if (!read.ok) throw this.readFailure(`${key} couldn't be read from ${connection}`, read);
    const used = (read.meta as { context?: { connection?: { value?: unknown } } }).context?.connection?.value;
    if (used !== connection) {
      return { status: 'proposal', why: 'unsupported', reason: `For ${toilProject}, toil would use ${typeof used === 'string' ? used : 'another connection'} rather than ${connection}, which ${key} belongs to, so Toil UI leaves the move to you.` };
    }
    const issue = asRecord(read.data);
    const isPull = issue.pull_request !== undefined && issue.pull_request !== null;
    const closed = issue.state === 'closed';

    // The Toil project's own boards, read the way the loader reads them (src/load.ts): the section's projects, under its owner or the first repository's.
    const shown = await this.call('projects show', { toilProject }, { signal });
    if (!shown.ok) throw this.readFailure(`toil couldn't read the Toil project ${toilProject}`, shown);
    const data = asRecord(shown.data);
    const toilProjectRecord = asRecord(data.toilProject);
    const section = asRecord(toilProjectRecord.github);
    const projects = (Array.isArray(section.projects) ? section.projects : []).flatMap((x) => (typeof x === 'string' || typeof x === 'number' ? [Number(x)] : [])).filter((x) => Number.isInteger(x) && x > 0);
    const boardOwner = typeof section.owner === 'string' && section.owner ? section.owner : githubRepos(toilProjectRecord, asRecord(asRecord(asRecord(data.areas).github).inputs) as Record<string, string>)[0]?.owner;

    let plan: { command: string; input: Record<string, unknown>; toStatus: string };
    if (projects.length > 0) {
      const found = await this.onBoard(toilProject, boardOwner, projects, owner, repo, n, signal);
      if (!found) return { status: 'proposal', why: 'unsupported', reason: `${key} isn't on a GitHub project board ${toilProject} reads, so it has no Status to set. Add it to the board first.` };
      if (closed && to !== 'DONE') return { status: 'proposal', why: 'unsupported', reason: `${key} is closed, and a closed issue stays in Done whatever its Status says. Reopen it first.` };
      const fields = await this.call('github project fields', { toilProject, ...(boardOwner ? { owner: boardOwner } : {}), project: found.project }, { signal });
      if (!fields.ok) throw this.readFailure(`The Status options of project ${found.project} couldn't be read`, fields);
      const status = (Array.isArray(fields.data) ? fields.data : []).map(asRecord).find((f) => f.name === GITHUB_STATUS_FIELD);
      const options = (Array.isArray(status?.options) ? status.options : []).flatMap((o) => (typeof asRecord(o).name === 'string' ? [asRecord(o).name as string] : []));
      const fit = options.filter((name) => GITHUB_STATUSES[name.toLowerCase()] === to);
      if (fit.length !== 1) {
        return {
          status: 'proposal',
          why: 'choices',
          reason: fit.length === 0 ? `Project ${found.project} has no ${GITHUB_STATUS_FIELD} option that toil reads as ${COLUMN_WORD[to]}.` : `More than one ${GITHUB_STATUS_FIELD} option of project ${found.project} reads as ${COLUMN_WORD[to]}, and Toil UI does not choose between them.`,
          detail: options.length ? `The project's ${GITHUB_STATUS_FIELD} options are: ${options.join('; ')}. Pass one with --to <status>.` : `The project has no ${GITHUB_STATUS_FIELD} field with options.`,
        };
      }
      plan = { command: 'github project status', input: { toilProject, item: found.itemId, to: fit[0]! }, toStatus: fit[0]! };
    } else {
      if (isPull) return { status: 'proposal', why: 'unsupported', reason: `${key} is a pull request, and closing one is not finishing it, so it is not a board move. Merge or close it with its own command.` };
      if (to === 'IN_PROGRESS') return { status: 'proposal', why: 'unsupported', reason: "A GitHub issue is only open or closed, so it has no In progress to move to or from. A project board's Status gives it one." };
      if (issue.state !== 'open' && issue.state !== 'closed') return { status: 'proposal', why: 'unsupported', reason: `${key} is neither open nor closed as GitHub reports it, so Toil UI leaves the move to you.` };
      if ((to === 'DONE') === closed) return { status: 'proposal', why: 'unsupported', reason: `${key} is already ${closed ? 'closed' : 'open'}, so there is nothing to change. Reload the board.` };
      plan = to === 'DONE' ? { command: 'github issue close', input: { toilProject, owner, repo, number: n }, toStatus: 'closed' } : { command: 'github issue reopen', input: { toilProject, owner, repo, number: n }, toStatus: 'open' };
    }

    if (!writesOn) {
      return { status: 'proposal', why: 'writes-off', reason: `Changes to ${connection} are switched off, so this move wasn't applied. Turn them on under Settings, Connections, or apply the proposal yourself.` };
    }
    const done = await this.call(plan.command, { ...plan.input, allowWrite: true }, { write: true, signal });
    if (done.ok) return { status: 'applied', transition: null, toStatus: plan.toStatus };
    // As above: toil refused before anything was sent, and says what to pass instead.
    if (done.error.code === 'INVALID_INPUT') return { status: 'proposal', why: 'choices', reason: done.error.message, ...(done.error.fix ? { detail: done.error.fix } : {}) };
    throw new BoardRefusal(done.error.message, done.error.fix ?? 'Check GitHub before trying again.', done.error.code === 'WRITE_DISABLED' ? 403 : 502);
  }

  /** The project item that holds an issue or pull request, on the first of the Toil project's boards that has it. */
  private async onBoard(toilProject: string, boardOwner: string | undefined, projects: number[], owner: string, repo: string, number: number, signal: AbortSignal): Promise<{ project: number; itemId: string } | null> {
    const slug = `${owner}/${repo}`.toLowerCase();
    for (const project of projects) {
      const answer = await this.call('github project items', { toilProject, ...(boardOwner ? { owner: boardOwner } : {}), project }, { signal });
      if (!answer.ok) throw this.readFailure(`The items of project ${project} couldn't be read`, answer);
      for (const raw of Array.isArray(answer.data) ? answer.data : []) {
        const entry = asRecord(raw);
        const content = asRecord(entry.content);
        if (content.number === number && String(asRecord(content.repository).nameWithOwner).toLowerCase() === slug && typeof entry.id === 'string') return { project, itemId: entry.id };
      }
    }
    return null;
  }
}

/** The sample's backend for `toil-ui --sample`: every move is a proposal, because the sample writes nothing. */
export function sampleBoard(): BoardBackend {
  return { move: async () => SAMPLE_MOVE };
}

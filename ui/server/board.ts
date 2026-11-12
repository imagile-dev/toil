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
 *   Status says, so moving one out of Done is blocked until it is reopened.
 * - **A card that isn't on the board.** The Toil project names a board and the
 *   issue isn't on it: a proposal (`why: 'not-on-board'`) saying so, naming the
 *   board, with `add`, the project, the issue and the Status option that fits.
 *   Nothing adds the issue on a plain drop. A person's press on "Add to the board
 *   and move" (`addToBoard`) runs `github project add`, then `github project
 *   status --item <the id it returned>`, each its own gated write, after every
 *   refusal has been made (one board, the card's owner is the board's, exactly
 *   one Status option fits, writes on). If the add works and the move doesn't, the
 *   refusal says exactly that. A board that can't be read is `blocked`
 *   (`board-unread`) with toil's own message and fix, never "not on the board".
 * - **GitHub, with no board.** The column is open or closed, and only those are
 *   moves: to Done is `github issue close`, back to To do is `github issue
 *   reopen`. GitHub issues have no In progress, and a pull request is not a
 *   board move (closing it is not finishing it, and merging is its own command),
 *   so both are `blocked`: no command could make the move, so the answer is the
 *   reason and the next step (name a board in the Toil project), not a proposal.
 * - **What stays a proposal.** A connection with `writes` off, a Toil project that
 *   would use another connection, a Status that isn't one option, a card off its
 *   board, and every move in the sample: each has a command a person can run. A
 *   move no command makes is `blocked`. The connection's `writes` decides, as it
 *   would typed by hand, and a toil project's unadopted binding is refused by toil
 *   itself (`WRITE_DISABLED`, with its fix).
 *
 * The call is `caller: 'toil-ui'` through toil's `execute()`, so toil's audit
 * log records it; this file keeps none of its own. A drop is a change request
 * with a signature, and the signature is the drop. The board it moves a card
 * across is a spreadsheet of record that agreed to be read.
 */

import { GITHUB_STATUSES, GITHUB_STATUS_FIELD } from '../../src/core/owi/github.ts';
import { MOVE_INTENT, NO_BOARD_REASON, SAMPLE_MOVE, noBoardNext, type BlockedWhy, type MoveColumn, type MoveOptions, type MoveOutcome, type NextStep } from '../src/board-api.ts';
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
  move(toilProject: string, item: string, to: MoveColumn, signal: AbortSignal, options?: MoveOptions): Promise<MoveOutcome>;
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

  async move(toilProject: string, item: string, to: MoveColumn, signal: AbortSignal, options: MoveOptions = {}): Promise<MoveOutcome> {
    const id = ITEM_ID.exec(item);
    if (!id) throw new BoardRefusal('That is not the id of a work item.', 'Send the OWI id the board shows, such as corp-jira:PAY-102.');
    const [, connection, key] = id as unknown as [string, string, string];
    if (this.busy.has(item)) throw new BoardRefusal(`${key} is already being moved.`, 'Wait for that move to finish; the board shows what came of it.', 409);
    this.busy.add(item);
    try {
      return await this.run(toilProject, item, connection, key, to, options, signal);
    } finally {
      this.busy.delete(item);
    }
  }

  private async run(toilProject: string, item: string, connection: string, key: string, to: MoveColumn, options: MoveOptions, signal: AbortSignal): Promise<MoveOutcome> {
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
    if (family === 'github') return this.github(toilProject, connection, key, to, row.writes === true, options, signal);
    if (family !== 'jira' && family !== 'ado') {
      return { status: 'blocked', why: 'unsupported', reason: `toil has no status change for ${area} items, so Toil UI can't move this card.`, next: { text: `Change its status in ${area} itself.` } };
    }
    // `ado work-item` takes the number; a key that isn't one is not an Azure DevOps work item.
    if (family === 'ado' && !/^\d+$/.test(key)) throw new BoardRefusal(`${key} is not an Azure DevOps work item number.`, 'Reload the page; the item id looks wrong.');

    // The tracker's own copy: it must exist, and toil must reach it through this item's connection.
    const read = family === 'jira' ? await this.call(`${area} issue get`, { toilProject, key }, { signal }) : await this.call(`${area} work-item get`, { toilProject, id: Number(key) }, { signal });
    if (!read.ok) throw new BoardRefusal(`${key} couldn't be read from ${connection}: ${read.error.message}`, read.error.fix ?? 'Check the item is still there, then try again.', read.error.code === 'NOT_FOUND' ? 404 : 400);
    const used = (read.meta as { context?: { connection?: { value?: unknown } } }).context?.connection?.value;
    if (used !== connection) {
      return this.otherConnection(toilProject, connection, key, used);
    }

    if (row.writes !== true) return this.writesOff(connection);

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
  private async github(toilProject: string, connection: string, key: string, to: MoveColumn, writesOn: boolean, options: MoveOptions, signal: AbortSignal): Promise<MoveOutcome> {
    const parsed = GITHUB_KEY.exec(key);
    if (!parsed || parsed[2] === '.' || parsed[2] === '..') throw new BoardRefusal(`${key} is not a GitHub issue or pull request.`, 'Reload the page; the item id looks wrong. It should read owner/repo#number.');
    const [, owner, repo, number] = parsed as unknown as [string, string, string, string];
    const n = Number(number);
    const blocked = (why: BlockedWhy, reason: string, next: NextStep): MoveOutcome => ({ status: 'blocked', why, reason, next });

    // The tracker's own copy: it must exist, and toil must reach it through this item's connection.
    const read = await this.call('github issue get', { toilProject, owner, repo, number: [n] }, { signal });
    if (!read.ok) throw this.readFailure(`${key} couldn't be read from ${connection}`, read);
    const used = (read.meta as { context?: { connection?: { value?: unknown } } }).context?.connection?.value;
    if (used !== connection) return this.otherConnection(toilProject, connection, key, used);
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
    const reopen = { text: `Reopen it first, then move it.`, command: { command: 'github issue reopen', input: { toilProject, owner, repo, number: n } } };
    const closedReason = `${key} is closed, and a closed issue stays in Done whatever its Status says.`;

    let plan: { command: string; input: Record<string, unknown>; toStatus: string };
    if (projects.length > 0) {
      if (closed && to !== 'DONE') return blocked('closed', closedReason, reopen);
      let found: { project: number; itemId: string } | null;
      try {
        found = await this.onBoard(toilProject, boardOwner, projects, owner, repo, n, signal);
      } catch (e) {
        if (e instanceof BoardUnread) return this.unread(connection, key, e);
        throw e;
      }
      if (!found) return this.notOnBoard({ toilProject, connection, key, owner, repo, number: n, to, writesOn, boardOwner, projects, options, signal });
      let options_: string[];
      try {
        options_ = await this.statusOptions(toilProject, boardOwner, found.project, signal);
      } catch (e) {
        if (e instanceof BoardUnread) return this.unread(connection, key, e);
        throw e;
      }
      const fit = options_.filter((name) => GITHUB_STATUSES[name.toLowerCase()] === to);
      if (fit.length !== 1) return this.choices(found.project, to, options_, fit.length);
      plan = { command: 'github project status', input: { toilProject, item: found.itemId, to: fit[0]! }, toStatus: fit[0]! };
    } else {
      // No board named: the column is open or closed, and the Toil project has no project board to give an issue an In progress.
      const nameIt = noBoardNext(toilProject);
      if (isPull) {
        return blocked('pull-request', `${key} is a pull request, and closing one is not finishing it, so it is only a board move on a project board. This Toil project doesn't name one.`, {
          text: 'Merge or close it with its own command, or name a project board in the Toil project and add the pull request to it. The board is created on GitHub first.',
          link: nameIt.link!,
          ...(nameIt.template ? { template: nameIt.template } : {}),
        });
      }
      if (to === 'IN_PROGRESS') return blocked('no-board', NO_BOARD_REASON, nameIt);
      if (issue.state !== 'open' && issue.state !== 'closed') return blocked('unsupported', `${key} is neither open nor closed as GitHub reports it, so Toil UI can't move it.`, { text: `Change it on GitHub.` });
      if ((to === 'DONE') === closed) return blocked('stale', `${key} is already ${closed ? 'closed' : 'open'}, so there is nothing to change.`, { text: 'Reload the board: it was out of date.' });
      plan = to === 'DONE' ? { command: 'github issue close', input: { toilProject, owner, repo, number: n }, toStatus: 'closed' } : { command: 'github issue reopen', input: { toilProject, owner, repo, number: n }, toStatus: 'open' };
    }

    if (!writesOn) return this.writesOff(connection);
    const done = await this.call(plan.command, { ...plan.input, allowWrite: true }, { write: true, signal });
    if (done.ok) return { status: 'applied', transition: null, toStatus: plan.toStatus };
    // As above: toil refused before anything was sent, and says what to pass instead.
    if (done.error.code === 'INVALID_INPUT') return { status: 'proposal', why: 'choices', reason: done.error.message, ...(done.error.fix ? { detail: done.error.fix } : {}) };
    throw new BoardRefusal(done.error.message, done.error.fix ?? 'Check GitHub before trying again.', done.error.code === 'WRITE_DISABLED' ? 403 : 502);
  }

  private writesOff(connection: string): MoveOutcome {
    return { status: 'proposal', why: 'writes-off', reason: `Changes to ${connection} are switched off, so this move wasn't applied. Turn them on under Settings, Connections, or apply the proposal yourself.` };
  }

  /** The Toil project would use another connection than the card's: nothing is sent, and the person is told how to carry on. */
  private otherConnection(toilProject: string, connection: string, key: string, used: unknown): MoveOutcome {
    return { status: 'proposal', why: 'unsupported', reason: `For ${toilProject}, toil would use ${typeof used === 'string' ? used : 'another connection'} rather than ${connection}, which ${key} belongs to, so Toil UI won't move it. Point the Toil project at ${connection}, or run the command yourself with --connection ${connection}.` };
  }

  /** A board or its Status options that couldn't be read: that is said, with toil's message and fix, and never turned into "not on the board". */
  private unread(connection: string, key: string, e: BoardUnread): MoveOutcome {
    return {
      status: 'blocked',
      why: 'board-unread',
      reason: `${e.what} couldn't be read, so toil can't tell where ${key} stands on it: ${e.message}`,
      next: { text: e.fix, link: { kind: 'connection', name: connection, label: `Check the ${connection} connection` } },
    };
  }

  /** More than one Status option, or none, reads as the column: nothing is chosen for the person. */
  private choices(project: number, to: MoveColumn, options: string[], fits: number): MoveOutcome {
    return {
      status: 'proposal',
      why: 'choices',
      reason: fits === 0 ? `Project ${project} has no ${GITHUB_STATUS_FIELD} option that toil reads as ${COLUMN_WORD[to]}.` : `More than one ${GITHUB_STATUS_FIELD} option of project ${project} reads as ${COLUMN_WORD[to]}, and Toil UI does not choose between them.`,
      detail: options.length ? `The project's ${GITHUB_STATUS_FIELD} options are: ${options.join('; ')}. Pass one with --to <status>.` : `The project has no ${GITHUB_STATUS_FIELD} field with options.`,
    };
  }

  /** A project's Status options, by name; a read that fails is a BoardUnread. */
  private async statusOptions(toilProject: string, boardOwner: string | undefined, project: number, signal: AbortSignal): Promise<string[]> {
    const fields = await this.call('github project fields', { toilProject, ...(boardOwner ? { owner: boardOwner } : {}), project }, { signal });
    if (!fields.ok) throw new BoardUnread(`The Status options of project ${project}`, fields.error.message, fields.error.fix);
    const status = (Array.isArray(fields.data) ? fields.data : []).map(asRecord).find((f) => f.name === GITHUB_STATUS_FIELD);
    return (Array.isArray(status?.options) ? status.options : []).flatMap((o) => (typeof asRecord(o).name === 'string' ? [asRecord(o).name as string] : []));
  }

  /**
   * The card isn't on the Toil project's board, so it has no Status to set. Everything that can be refused is refused here, before
   * anything is added: the one Status option that fits, whether the connection lets the app write, and that the card's owner is the
   * board's. A plain drop only says so, with the commands. Pressing "Add to the board and move" asks for the add too (`addToBoard`),
   * and then it adds the card, sets its Status through the item id the add returned, and says exactly where it stopped if it stops.
   */
  private async notOnBoard(a: { toilProject: string; connection: string; key: string; owner: string; repo: string; number: number; to: MoveColumn; writesOn: boolean; boardOwner: string | undefined; projects: number[]; options: MoveOptions; signal: AbortSignal }): Promise<MoveOutcome> {
    const { toilProject, connection, key, owner, repo, number, to, writesOn, boardOwner, projects, options, signal } = a;
    // The board's own name and address, when toil can read them; a failed read leaves them out and the number says which it is.
    let board: { project: number; title: string | null; url: string | null } | undefined;
    const listed = await this.call('github project list', { toilProject, ...(boardOwner ? { owner: boardOwner } : {}) }, { signal });
    if (listed.ok) {
      for (const raw of Array.isArray(listed.data) ? listed.data : []) {
        const p = asRecord(raw);
        if (p.number === projects[0] && projects.length === 1) board = { project: projects[0]!, title: typeof p.title === 'string' ? p.title : null, url: safeUrl(p.url) };
      }
    }
    const one = projects.length === 1 ? projects[0]! : null;
    const name = one === null ? '' : board?.title ? `"${board.title}" (project ${one})` : `project ${one}`;
    const reason = one === null ? `${key} isn't on any of the project boards this Toil project names (${projects.join(', ')}), so it has no Status to set. Add it to one of them, then move it.` : `${key} isn't on the project board ${name}. Add it there, then move it.`;
    const base = { status: 'proposal', why: 'not-on-board', reason, ...(board ? { board } : {}) } as const;
    if (one === null) return { ...base, detail: 'Add it to the board with toil github project add <project> <number>, naming the project it belongs on.' };
    // The add runs under the card's owner, so a board under another owner is the person's to add to.
    if (!boardOwner || boardOwner.toLowerCase() !== owner.toLowerCase()) {
      return { ...base, detail: `${boardOwner ?? 'The board'}'s project can't be added to from ${owner}/${repo} here. Add the issue on the project's page.` };
    }
    let statuses: string[];
    try {
      statuses = await this.statusOptions(toilProject, boardOwner, one, signal);
    } catch (e) {
      if (e instanceof BoardUnread) return { ...base, detail: `${e.what} couldn't be read, so the move can't be planned: ${e.message} ${e.fix}` };
      throw e;
    }
    const fit = statuses.filter((s) => GITHUB_STATUSES[s.toLowerCase()] === to);
    if (fit.length !== 1) {
      const c = this.choices(one, to, statuses, fit.length) as Extract<MoveOutcome, { status: 'proposal' }>;
      return { ...base, ...(c.detail ? { detail: c.detail } : {}) };
    }
    const add = { project: one, number, status: fit[0]!, canApply: writesOn };
    if (!writesOn) return { ...base, add, detail: `Changes to ${connection} are switched off, so toil can't add it for you. Turn them on under Settings, Connections, or run the commands yourself.` };
    if (options.addToBoard !== true) return { ...base, add };

    const put = await this.call('github project add', { toilProject, owner, repo, project: one, number, allowWrite: true }, { write: true, signal });
    if (!put.ok) throw new BoardRefusal(`${key} was not added to ${name}: ${put.error.message}`, put.error.fix ?? 'Nothing was changed. Check GitHub before trying again.', put.error.code === 'WRITE_DISABLED' ? 403 : 502);
    const item = asRecord(put.data).item;
    if (typeof item !== 'string') throw new BoardRefusal(`${key} may have been added to ${name}, but toil returned no project item to move.`, `Check the project's page, then drop the card again.`, 502);
    const moved = await this.call('github project status', { toilProject, item, to: add.status, allowWrite: true }, { write: true, signal });
    if (moved.ok) return { status: 'applied', transition: null, toStatus: add.status, added: true };
    throw new BoardRefusal(`${key} was added to ${name}, but its Status was not set to ${add.status}: ${moved.error.message}`, `${moved.error.fix ?? ''} It is on the board now, so drop the card on the column again, or set it with toil github project status.`.trim(), moved.error.code === 'WRITE_DISABLED' ? 403 : 502);
  }

  /** The project item that holds an issue or pull request, on the first of the Toil project's boards that has it; a board that can't be read is a BoardUnread. */
  private async onBoard(toilProject: string, boardOwner: string | undefined, projects: number[], owner: string, repo: string, number: number, signal: AbortSignal): Promise<{ project: number; itemId: string } | null> {
    const slug = `${owner}/${repo}`.toLowerCase();
    for (const project of projects) {
      const answer = await this.call('github project items', { toilProject, ...(boardOwner ? { owner: boardOwner } : {}), project }, { signal });
      if (!answer.ok) throw new BoardUnread(`The project board ${project}`, answer.error.message, answer.error.fix);
      for (const raw of Array.isArray(answer.data) ? answer.data : []) {
        const entry = asRecord(raw);
        const content = asRecord(entry.content);
        if (content.number === number && String(asRecord(content.repository).nameWithOwner).toLowerCase() === slug && typeof entry.id === 'string') return { project, itemId: entry.id };
      }
    }
    return null;
  }
}

/** A board or its fields that toil couldn't read: `what` names it, `message` and `fix` are toil's own words. */
class BoardUnread extends Error {
  readonly fix: string;
  constructor(readonly what: string, message: string, fix: string | undefined) {
    super(message);
    this.fix = fix ?? 'Check that the token can read the project, then try again.';
  }
}

/** An address from toil's data that is safe to link to: http or https only, never a script. */
function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The sample's backend for `toil-ui --sample`: every move is a proposal, because the sample writes nothing. */
export function sampleBoard(): BoardBackend {
  return { move: async () => SAMPLE_MOVE };
}

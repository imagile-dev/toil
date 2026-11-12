/**
 * The board (#252): one column per OWI status category, so items from any
 * tracker sit side by side under the same headings, each still showing its
 * source's own status word. A move on the board is a proposal
 * (src/proposal.ts), where a command exists, naming the toil write command that would make it, with
 * the column's intent (`--to start`), which toil resolves against that
 * item's own workflow; a GitHub project's Status word is taken from items the
 * toil project already shows in that column. It is a
 * proposal when a person has turned applying moves off, and wherever the
 * server can't apply it (see `appliesItself`); otherwise the server makes the
 * move itself (ui/server/board.ts) and this file's command is only the fallback. A GitHub issue
 * with no project board has only open and closed, so Done is `github issue close`, To do
 * `github issue reopen`, and In progress is no move at all. Where a name isn't known, the
 * proposal says so instead of guessing.
 * A kanban board where nothing moves until somebody signs.
 */

import { STATUS_CATEGORY_LABEL, shortKey } from '../format.ts';
import { MOVE_INTENT, NO_BOARD_REASON, noBoardNext, type AddToBoard, type BlockedWhy, type MoveColumn, type NextStep } from '../board-api.ts';
import type { Proposal } from '../proposal.ts';
import type { ToilProjectData } from '../load.ts';
import type { StatusCategory, WorkItem } from '../toil.ts';
import { flows } from './flow.ts';

/** The `native` record of the board item an issue was mapped from (`github project items`), whose `id` is the project item id. */
export const GITHUB_ITEMS = 'github project items';
/** Added by the loader beside it: which project that board is, `{ project, owner? }`. */
export const GITHUB_BOARD_KEY = 'github project';

export const COLUMNS: StatusCategory[] = ['TODO', 'IN_PROGRESS', 'DONE'];

export interface Column {
  category: StatusCategory;
  items: WorkItem[];
}

/** The board's columns, in the toil project's own order; Unknown only when some item is. */
export function columns(items: WorkItem[]): Column[] {
  const shown = items.filter(flows);
  const cats = shown.some((i) => i.statusCategory === 'UNKNOWN') ? [...COLUMNS, 'UNKNOWN' as const] : COLUMNS;
  return cats.map((category) => ({ category, items: shown.filter((i) => i.statusCategory === category) }));
}

const family = (item: WorkItem) => item.source.area.split('-')[0]!;

/**
 * The status word the toil project's items from the same tracker use for a
 * category, most common first: among items of the same type when any has
 * one, since a workflow's states can differ by type (Scrum's backlog item is
 * Committed where its task is In Progress), else among all of them.
 */
export function statusFor(item: WorkItem, to: StatusCategory, items: WorkItem[]): string | null {
  // A GitHub issue's own state (open, closed) is not a Status option: its word is the board's Status value, and only items on a board have one.
  const word = (i: WorkItem) => (family(i) === 'github' ? boardStatus(i) : i.status);
  const peers = items.filter((i) => family(i) === family(item) && i.source.connection === item.source.connection && i.statusCategory === to && word(i));
  const sameType = peers.filter((i) => i.typeName === item.typeName);
  const counts = new Map<string, number>();
  for (const i of sameType.length ? sameType : peers) counts.set(word(i)!, (counts.get(word(i)!) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The project item id of a GitHub issue that lives on a board, else null. */
export function boardItemId(item: WorkItem): string | null {
  const entry = item.native[GITHUB_ITEMS] as { id?: unknown } | undefined;
  return typeof entry?.id === 'string' ? entry.id : null;
}

/** The name of the Status option a board item holds, else null: the board's own word, which an issue's closed state hides in `status`. */
export function boardStatus(item: WorkItem): string | null {
  const entry = item.native[GITHUB_ITEMS] as { fieldValues?: unknown } | undefined;
  const values = Array.isArray(entry?.fieldValues) ? (entry.fieldValues as Array<{ name?: unknown; field?: { name?: unknown } }>) : [];
  const status = values.find((v) => v.field?.name === 'Status' && typeof v.name === 'string');
  return status ? (status.name as string) : null;
}

/** Whether a card can be moved at all, decided before anyone drags it; the reason is plain words for the person. */
export type CanMove = { ok: true } | { ok: false; reason: string };

/**
 * Whether toil can propose a move for this card, whichever column it goes to.
 * The board uses it to switch dragging off, and `proposeMove` asks it first, so
 * a card and its proposal never disagree. By the time the board draws, the
 * toil project's items and the project boards it names are read, so an issue
 * with no board record is known to be off the board, not still loading.
 */
export function canMove(item: WorkItem): CanMove {
  const fam = family(item);
  // A GitHub issue on a board moves by its Status; one with no board is open or closed, which Done and To do set. Every card is a card.
  if (fam === 'github') return { ok: true };
  if (fam === 'jira' || fam === 'ado') return { ok: true };
  return { ok: false, reason: `Can't be moved here: toil has no status change for ${item.source.area} items.` };
}

/** An issue's key as the loader forms it, `owner/repo#number`; a draft on a board has none (its key is `owner/draft/<id>`). */
const GITHUB_ISSUE_KEY = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;

/**
 * Whether Toil UI can apply this item's move itself: Jira and Azure DevOps, whose
 * toil commands resolve a column's intent against the item's own workflow, and a
 * GitHub issue, which the server moves by its project Status option (the one toil
 * reads as the column) or, with no board, by closing or reopening it. A draft on a
 * board has no issue number to name, so its move stays a proposal, with its command.
 */
export const appliesItself = (item: WorkItem): boolean => (family(item) === 'github' ? GITHUB_ISSUE_KEY.test(item.source.key) : ['jira', 'ado'].includes(family(item)));

/** A move no command can make yet, with what to do first; the Board shows it as one notice, in place of a proposal. */
export interface MoveBlock {
  why: BlockedWhy;
  reason: string;
  next: NextStep;
}

type Boards = ToilProjectData['githubBoards'];

/**
 * Whether the loaded data already says a GitHub card can't go to (or leave) In progress: the Toil project names no project
 * board, so the issue has only open and closed. The same answer the server gives (ui/server/board.ts), known before a drop so
 * the page needs no round trip and the card is never shown moving. Null where the data doesn't say (no GitHub section, or a
 * view older than this field): the server decides then.
 */
export function boardBlock(item: WorkItem, to: StatusCategory, boards: Boards | undefined, toilProject: string): MoveBlock | null {
  if (family(item) !== 'github' || !boards || boards.projects.length > 0 || !GITHUB_ISSUE_KEY.test(item.source.key)) return null;
  if (to !== 'IN_PROGRESS' && item.statusCategory !== 'IN_PROGRESS') return null;
  return { why: 'no-board', reason: NO_BOARD_REASON, next: noBoardNext(toilProject) };
}

/** The words for a column that can't take this card, said while it is dragged, or null: "Needs a project board" for In progress. */
export function dropRefusal(item: WorkItem, to: StatusCategory, boards: Boards | undefined): string | null {
  return to === 'IN_PROGRESS' && boardBlock(item, to, boards, '') ? 'Needs a project board to go here' : null;
}

/**
 * What moving an item to another column would take; null when it's already there. `boards` (what the Toil project names) says,
 * for a GitHub card with no board record, whether it is off a named board (put it on, then move it) or the Toil project names
 * none; `add` is the server's own plan for that, whose Status option is the one it checked.
 */
export function proposeMove(item: WorkItem, to: StatusCategory, items: WorkItem[], toilProject: string, boards?: Boards, add?: AddToBoard): Proposal | null {
  if (to === item.statusCategory || to === 'UNKNOWN') return null;
  const key = shortKey(item);
  const label = STATUS_CATEGORY_LABEL[to];
  const status = statusFor(item, to, items);
  const base = { id: `board:${item.id}:${to}`, from: 'board' as const, item: item.id, title: `Move ${key} to ${label}`, reason: `Dragged on the board from ${STATUS_CATEGORY_LABEL[item.statusCategory]} (${item.status ?? 'no status'}).` };
  const fam = family(item);
  // The card is not draggable in this case; this is the safety net for a move that arrives by another way.
  const can = canMove(item);
  if (!can.ok) {
    return { ...base, command: null, input: null, note: `${key}: ${can.reason}${fam === 'github' ? ` Add it to the board first${item.url ? `: ${item.url}` : ''}.` : ''}` };
  }
  // The server's own plan (`add`) wins over what the page loaded: the card may still hold a board record from before it was taken off the board.
  if (fam === 'github' && (add || !boardItemId(item))) {
    const at = GITHUB_ISSUE_KEY.exec(item.source.key);
    if (!at) return { ...base, command: null, input: null, note: `${key} has no issue number to name.` };
    const where = { toilProject, owner: at[1]!, repo: at[2]!, number: Number(at[3]) };
    // A board is named and this card has no record on it: put it on the board, then set its Status, two writes in that order.
    const named = add ? [add.project] : boards ? boards.projects : [];
    if (named.length > 0) {
      if (!add && (named.length > 1 || (boards?.unread.length ?? 0) > 0)) {
        return { ...base, command: null, input: null, note: `${key} has no Status because it isn't on a project board this Toil project reads. Add it to the right board with toil github project add <project> ${where.number}, then move it.` };
      }
      const project = named[0]!;
      const status = add?.status ?? statusFor(item, to, items);
      const put = { toilProject, owner: where.owner, repo: where.repo, project, number: where.number };
      return {
        ...base,
        command: 'github project add',
        input: put,
        note: `${key} isn't on project ${project}, so it has no Status to set. Add it to the board, then move it.`,
        ...(status ? { then: { text: `Then set its Status to ${label}:`, command: 'github project status', input: { ...put, to: status } } } : { hint: { text: 'Then set its Status to one of the project\'s options:', command: 'github project fields', input: { toilProject, owner: where.owner, project } } }),
      };
    }
    // No board: the column is open or closed, and only Done and To do are moves; the server runs the same command.
    if (to === 'DONE') return { ...base, command: 'github issue close', input: where, note: 'A GitHub issue with no project board is only open or closed: Done closes it.' };
    if (to === 'TODO') return { ...base, command: 'github issue reopen', input: where, note: 'A GitHub issue with no project board is only open or closed: To do reopens it.' };
    return { ...base, command: null, input: null, note: `${key}: ${NO_BOARD_REASON}` };
  }
  if (fam === 'github') {
    const boardId = boardItemId(item)!;
    // The loader records which board the item came from; without it there is no project number to list the options of.
    const on = item.native[GITHUB_BOARD_KEY] as { project?: number; owner?: string } | undefined;
    const options = on?.project !== undefined ? { text: "List the Status options the project has:", command: 'github project fields', input: { toilProject, project: on.project, ...(on.owner ? { owner: on.owner } : {}) } } : undefined;
    if (!status) {
      return { ...base, command: null, input: null, note: `No ${label} item on this Toil project's board shows which Status to use.`, ...(options ? { hint: options } : {}) };
    }
    return { ...base, command: 'github project status', input: { toilProject, item: boardId, to: status }, note: `"${status}" is the Status other ${label} items use; the project may name its columns differently, and an unknown one is refused with the real options.`, ...(options ? { hint: options } : {}) };
  }
  // Each Jira and Azure DevOps pair (Data Center or Server, and Cloud) names its commands alike, so the item's own area fills the path.
  // The command takes the column's intent, the one the server sends: toil resolves it against this item's own workflow and, when no single move fits, lists the ones it has.
  const transitions = { text: 'List the transitions the workflow offers:', command: `${item.source.area} issue transitions`, input: { toilProject, key: item.source.key } };
  const states = { text: 'List the states the work item type has:', command: `${item.source.area} work-item states`, input: { toilProject, type: item.typeName ?? 'User Story' } };
  const note = `toil picks the ${label} move from this item's own workflow, and lists the moves it has when none fits.`;
  if (fam === 'jira') {
    return { ...base, command: `${item.source.area} issue transition`, input: { toilProject, key: item.source.key, to: MOVE_INTENT[to as MoveColumn] }, note, hint: transitions };
  }
  if (fam === 'ado') {
    return { ...base, command: `${item.source.area} work-item transition`, input: { toilProject, id: Number(item.source.key), to: MOVE_INTENT[to as MoveColumn] }, note, hint: states };
  }
  return { ...base, command: null, input: null, note: `toil has no status change for ${item.source.area} items.` };
}

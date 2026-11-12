/**
 * The Board's drop, as the page and the server both read it: a person moved a
 * card to another column, and the server either made the change through toil's
 * own command (behind the connection's `writes`) or says why it didn't, so the
 * page shows the proposal it always showed. The page names a Toil project, an
 * item and a column; the server works out the rest. A move with a form for
 * every column, and a refusal for every form.
 */

/** The columns a card can be dropped on: the three statuses a tracker has a word for. */
export type MoveColumn = 'TODO' | 'IN_PROGRESS' | 'DONE';

export const MOVE_COLUMNS: readonly MoveColumn[] = ['TODO', 'IN_PROGRESS', 'DONE'];

/**
 * toil's own intent for each column (`jira issue transition --to`, `ado
 * work-item transition --to`): resolved by toil against the item's own
 * workflow, and refused, with the moves it does offer, unless exactly one fits.
 */
export const MOVE_INTENT: Record<MoveColumn, 'reopen' | 'start' | 'done'> = { TODO: 'reopen', IN_PROGRESS: 'start', DONE: 'done' };

/** Why a drop was left as a proposal: a command exists that would make it, and nobody has run it. */
export type ProposalWhy = 'sample' | 'writes-off' | 'unsupported' | 'choices' | 'not-on-board';

/**
 * Why a drop can't be made by any command yet, so there is nothing to propose: something has to change first, and the notice
 * says what. A GitHub issue with no project board has no In progress; a board that couldn't be read says nothing about the
 * issue; a closed issue stays in Done until it is reopened.
 */
export type BlockedWhy = 'no-board' | 'board-unread' | 'pull-request' | 'closed' | 'stale' | 'unsupported';

/** Where a person goes to do the next step, as the page turns it into a link: its own screens by kind, GitHub by address. */
export type NextLink = { kind: 'toil-project'; label: string } | { kind: 'connection'; name: string; label: string } | { kind: 'url'; href: string; label: string };

/** What to do about a move that can't be made yet: a sentence, a place, and the command that does it when there is one. */
export interface NextStep {
  /** One sentence: the step. */
  text: string;
  link?: NextLink;
  /** A toil command that does the step, as the page shows it: its exact input. */
  command?: { command: string; input: Record<string, unknown> };
  /** A command with a blank only the person can fill (a project's number), shown as it is typed, never run. */
  template?: string;
}

/**
 * Putting a card on the board, then moving it, as one press: the project and the issue's number, the Status option that fits the
 * column, and whether the connection lets the app do it (writes on). The command lines are shown whenever it is set.
 */
export interface AddToBoard {
  project: number;
  number: number;
  /** The one Status option that reads as the column. */
  status: string;
  canApply: boolean;
}

/** What came of one drop. A failure is not an outcome: it is thrown, with toil's own message and fix. */
export type MoveOutcome =
  | { status: 'applied'; /** The transition toil chose, when it says. */ transition: string | null; toStatus: string | null; /** True when the card was put on the board first. */ added?: true }
  | { status: 'proposal'; why: ProposalWhy; /** One line: why nothing was changed. */ reason: string; /** The moves the workflow offers, in toil's words, when that is why. */ detail?: string; /** For a card that isn't on its board: the add and the move. */ add?: AddToBoard; /** The project board's name and address, when known. */ board?: { project: number; title: string | null; url: string | null } }
  | { status: 'blocked'; why: BlockedWhy; reason: string; next: NextStep };

/** Extras on a drop: pressing "Add to the board and move" asks for the add too. Nothing else is ever added. */
export interface MoveOptions {
  addToBoard?: boolean;
}

/**
 * Case 1, in one place for the page (which knows it from the loaded data, before any call) and the server (which says the same
 * when asked): a GitHub issue has only open and closed, so In progress needs a project board, and the Toil project names none.
 */
export const NO_BOARD_REASON = "GitHub issues are only open or closed, so In progress needs a project board. This Toil project doesn't name one.";

export function noBoardNext(toilProject: string): NextStep {
  return {
    text: 'Create a project board on GitHub if there is none, name it in the Toil project, then add the issue to it.',
    link: { kind: 'toil-project', label: 'Name a project board in this Toil project' },
    // The number is the board's, which only the person knows; the command is shown as it is typed, with the blank left in it.
    template: `toil projects link ${toilProject} github --add projects=<number>`,
  };
}

export const isMoveColumn = (v: unknown): v is MoveColumn => typeof v === 'string' && (MOVE_COLUMNS as readonly string[]).includes(v);

/** The sample's answer: it can show a move and write none. */
export const SAMPLE_MOVE: MoveOutcome = { status: 'proposal', why: 'sample', reason: "This is sample data, so a move can't be applied. Here is what would run with your own work." };

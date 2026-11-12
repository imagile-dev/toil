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

/** Why a drop was left as a proposal. */
export type ProposalWhy = 'sample' | 'writes-off' | 'unsupported' | 'choices';

/** What came of one drop. A failure is not an outcome: it is thrown, with toil's own message and fix. */
export type MoveOutcome =
  | { status: 'applied'; /** The transition toil chose, when it says. */ transition: string | null; toStatus: string | null }
  | { status: 'proposal'; why: ProposalWhy; /** One line: why nothing was changed. */ reason: string; /** The moves the workflow offers, in toil's words, when that is why. */ detail?: string };

export const isMoveColumn = (v: unknown): v is MoveColumn => typeof v === 'string' && (MOVE_COLUMNS as readonly string[]).includes(v);

/** The sample's answer: it can show a move and write none. */
export const SAMPLE_MOVE: MoveOutcome = { status: 'proposal', why: 'sample', reason: "This is sample data, so a move can't be applied. Here is what would run with your own work." };

/**
 * A Jira search that came back with `changelog: true` carries each issue's
 * change history inline (`issue.changelog.histories`). `mapOwi` reads a history
 * from what `jira issue history <key>` returns, wrapped as `{ key, history }`,
 * and puts both the issue and the history under `native`. So the inline answer
 * is split back into the two inputs `mapOwi` has always had: the search with
 * its changelogs taken off, and one `issue history` envelope per issue, built
 * from the search's own envelope (same connection, same deployment, same
 * warnings-free meta) with the history entries as `data`.
 *
 * Jira may send a changelog shorter than the issue has. Cloud's search caps it
 * at 20 entries and reports `total` as the count on the page, so the entries
 * only count as whole when `total` equals them and they leave room on the
 * page (`histories.length < maxResults`). Anything else, or a single issue
 * with no changelog, is returned in `incomplete`, and the loader reads it with
 * `issue history`, which reads the whole history. Nothing partial is ever
 * mapped as if complete. (An older toil does not fall back: it refuses the
 * `changelog` field, since input is strict, and the search fails.)
 *
 * Reconciling two sources of one history has been known to need a working group. This is a function.
 */

import type { Envelope } from './toil.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SplitSearch {
  /** The search answer as `issue search` sends it without `--changelog`: no `changelog` on any issue. */
  search: Envelope;
  /** One per issue whose changelog came back whole, in the shape of the `issue history` call's envelope. */
  histories: Array<{ key: string; history: Envelope }>;
  /** Keys of issues whose changelog is missing or shorter than Jira says: read these with `issue history`. */
  incomplete: string[];
}

/** The entries of one issue's inline changelog, if Jira sent all of them. */
function wholeHistories(changelog: unknown): Rec[] | null {
  if (!isRec(changelog) || !Array.isArray(changelog.histories)) return null;
  const histories = changelog.histories.filter(isRec);
  if (typeof changelog.total !== 'number' || changelog.total !== histories.length) return null;
  if (typeof changelog.maxResults !== 'number' || histories.length >= changelog.maxResults) return null;
  return histories;
}

/**
 * `issue history` lists entries oldest first, on both deployments. Cloud's
 * search sends them newest first (Data Center's order is undocumented,
 * docs/decisions/493-jira-changelog.md), so a list that runs newest first is
 * turned round, which gives `mapOwi` the entries in the order
 * `issue history` would have. A list already oldest first is left alone.
 */
function oldestFirst(histories: Rec[]): Rec[] {
  const at = (h: Rec | undefined) => Date.parse(String(h?.created ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const first = at(histories[0]);
  const last = at(histories[histories.length - 1]);
  return Number.isFinite(first) && Number.isFinite(last) && first > last ? [...histories].reverse() : histories;
}

export function splitChangelogs(search: Envelope, historyCommand: string): SplitSearch {
  const data = search.data;
  if (!search.ok || !isRec(data) || !Array.isArray(data.issues)) return { search, histories: [], incomplete: [] };
  const histories: SplitSearch['histories'] = [];
  const incomplete: string[] = [];
  const meta = { ...search.meta, command: historyCommand } as Rec;
  delete meta.page;
  delete meta.warnings;
  const issues = data.issues.map((issue) => {
    if (!isRec(issue)) return issue;
    const { changelog, ...rest } = issue;
    const key = String(issue.key);
    const whole = wholeHistories(changelog);
    if (whole === null) incomplete.push(key);
    else histories.push({ key, history: { ok: true, data: oldestFirst(whole), error: null, meta } as unknown as Envelope });
    return rest;
  });
  return { search: { ...search, data: { ...data, issues } } as Envelope, histories, incomplete };
}

/**
 * The scripted agent's answers for `sample-team` and for "Ask about this chart"
 * (#567). Nothing here calls a model, and nothing is typed twice: every figure
 * is computed, when the answer is asked for, from the sample team's own
 * records (`SAMPLE_TEAM.owi`, the same ones the loader maps) through the
 * model's own pivot and release scope, or from the chart context the page
 * attached, so a script cannot say a number the data does not. The answers
 * were approved in advance, which is the only way a status report has ever
 * been approved on time.
 */

import { pivot, releaseScope, type PivotResult } from '../../../src/core/insights/index.ts';
import { insightsBase, type PersonLike } from '../insights-input.ts';
import type { ViewContext } from '../view-context.ts';
import { cellCite } from '../view-context.ts';
import type { WorkItem } from '../toil.ts';
import type { Script } from './agent.ts';
import { SAMPLE_AS_OF, SAMPLE_TEAM } from './sample-team.ts';

/** The shape the scripted agent keeps its answers in (fixtures/agent.ts). */
export type SampleScript = Script;

const cite = (id: string) => `[[${id}]]`;
const percent = (part: number, whole: number) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAY = 86_400_000;

/** The sample team's people, items and classification, built the way the screens build them. */
function base() {
  const people = (SAMPLE_TEAM.toilProject.people as PersonLike[]) ?? [];
  const scheme = (SAMPLE_TEAM.toilProject.classify as { scheme?: string } | undefined)?.scheme ?? null;
  return insightsBase(SAMPLE_TEAM.owi.items, people, scheme);
}

function run(measure: 'throughput' | 'items', split: string): PivotResult {
  const b = base();
  return pivot({ items: b.items, changes: SAMPLE_TEAM.owi.changes, spec: { measure, split }, asOf: SAMPLE_AS_OF, people: b.people, ...(b.categories ? { categories: b.categories } : {}), ...(b.scheme ? { scheme: b.scheme } : {}) });
}

/** The work mix: what was finished in the last 90 days, by category, from the pivot the Work mix tile runs. */
function mix(): SampleScript {
  const result = run('throughput', 'category');
  const total = result.total.value ?? 0;
  const rows = result.rows.map((row, r) => ({ row, cell: result.cells[r]![0]! })).filter((x) => x.cell.value !== null);
  const parts = [`${plural(total, 'item')} were finished in the ${plural(Math.round((Date.parse(`${result.period.to}T00:00:00Z`) - Date.parse(`${result.period.from}T00:00:00Z`)) / DAY) + 1, 'day')} up to ${result.period.to}.`];
  for (const { row, cell } of rows.sort((a, b) => (b.cell.value ?? 0) - (a.cell.value ?? 0)).slice(0, 2)) {
    const example = cell.items[0];
    parts.push(`${row.label}: ${cell.value} of them, ${percent(cell.value ?? 0, total)}${example ? `, for example ${cite(example)}` : ''}.`);
  }
  if (result.coverage.notes.length > 0) parts.push(result.coverage.notes[0]!);
  return { label: 'What is our work mix?', parts };
}

/** Release 2.4: its scope, what is done, and what arrived after work started, from the release scope the Releases tile reads. */
function release(): SampleScript {
  const name = '2.4';
  const scope = releaseScope(SAMPLE_TEAM.owi.items, name, SAMPLE_AS_OF);
  const parts = [`Release ${name} holds ${plural(scope.total, 'item')}: ${scope.done} done and ${scope.open} open.`];
  if (scope.added === null) parts.push('Its start day was not read, so how much scope arrived after work began cannot be said.');
  else parts.push(`${plural(scope.added, 'item')} ${scope.added === 1 ? 'was' : 'were'} created after its start day, ${scope.start}${scope.addedItems.length ? `, for example ${scope.addedItems.slice(0, 2).map(cite).join(' and ')}` : ''}. That counts only items created after the start, so it is a floor.`);
  if (scope.pastDue.length > 0) parts.push(`${plural(scope.pastDue.length, 'item')} still open after the release date, for example ${cite(scope.pastDue[0]!)}.`);
  return { label: 'How is release 2.4 going?', parts };
}

const open = (i: WorkItem) => i.statusCategory !== 'DONE';

/** The running sprint: what is left, what has no estimate, and what came over from an earlier sprint. */
function risk(): SampleScript {
  const current = SAMPLE_TEAM.owi.items.filter((i) => i.iteration?.state === 'current');
  const name = current[0]?.iteration?.name ?? null;
  if (!name) return { label: 'What is at risk this sprint?', parts: ['No sprint is running in the sample, so there is nothing to weigh.'] };
  const left = current.filter(open);
  const points = left.reduce((n, i) => n + (i.estimate?.value ?? 0), 0);
  const unestimated = left.filter((i) => !i.estimate);
  const carried = left.filter((i) => (i.sprints ?? []).length > 1);
  const parts = [`${name} has ${plural(left.length, 'open item')} of ${current.length}, holding ${points} points.`];
  if (unestimated.length > 0) parts.push(`${plural(unestimated.length, 'open item')} ${unestimated.length === 1 ? 'has' : 'have'} no estimate, so those points leave them out, for example ${cite(unestimated[0]!.id)}.`);
  if (carried.length > 0) parts.push(`${plural(carried.length, 'open item')} came over from an earlier sprint, for example ${cite(carried[0]!.id)}.`);
  return { label: 'What is at risk this sprint?', parts };
}

/** Pull requests waiting: how many are open, which has waited longest and which has no reviewer. */
function review(): SampleScript {
  const asOf = Date.parse(SAMPLE_AS_OF);
  const prs = SAMPLE_TEAM.owi.changes.filter((c) => c.state === 'OPEN' && c.created).sort((a, b) => Date.parse(a.created!) - Date.parse(b.created!));
  if (prs.length === 0) return { label: "What's waiting on a review?", parts: ['No pull request is open in the sample.'] };
  const oldest = prs[0]!;
  const days = Math.floor((asOf - Date.parse(oldest.created!)) / DAY);
  const unreviewed = prs.filter((c) => c.reviewers.length === 0);
  const parts = [`${plural(prs.length, 'pull request')} ${prs.length === 1 ? 'is' : 'are'} open. The oldest, ${cite(oldest.id)}, was opened ${plural(days, 'day')} ago.`];
  if (unreviewed.length > 0) parts.push(`${plural(unreviewed.length, 'open pull request')} ${unreviewed.length === 1 ? 'has' : 'have'} no reviewer asked yet, for example ${cite(unreviewed[0]!.id)}.`);
  return { label: "What's waiting on a review?", parts };
}

/** Load, never performance: who has items in progress, against the toil project's limit. */
function people(): SampleScript {
  const limit = SAMPLE_TEAM.toilProject.wipLimit as number | undefined;
  const byPerson = new Map<string, WorkItem[]>();
  for (const i of SAMPLE_TEAM.owi.items.filter((x) => x.statusCategory === 'IN_PROGRESS' && x.assignee)) {
    const who = i.assignee!.name ?? i.assignee!.id;
    byPerson.set(who, [...(byPerson.get(who) ?? []), i]);
  }
  const ranked = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return { label: 'Who has the most in progress?', parts: ['Nobody has an item in progress in the sample.'] };
  const parts = [`${plural(ranked.length, 'person', 'people')} ${ranked.length === 1 ? 'has' : 'have'} work in progress. This is load, not performance.`];
  for (const [who, items] of ranked.slice(0, 2)) parts.push(`${who} has ${plural(items.length, 'item')} in progress, for example ${cite(items[0]!.id)}.`);
  if (limit !== undefined) {
    const over = ranked.filter(([, items]) => items.length > limit);
    parts.push(over.length > 0 ? `${plural(over.length, 'person', 'people')} ${over.length === 1 ? 'is' : 'are'} over the limit of ${limit}.` : `Nobody is over the limit of ${limit}.`);
  }
  return { label: 'Who has the most in progress?', parts };
}

/** The five starters for `sample-team`, by the ids the guided questions route to. Built on first use, then kept. */
let scripts: Record<string, SampleScript> | undefined;
export function sampleTeamScripts(): Record<string, SampleScript> {
  scripts ??= { mix: mix(), release: release(), risk: risk(), review: review(), people: people() };
  return scripts;
}

/** The starters' ids and labels, without computing any answer. */
export const SAMPLE_TEAM_STARTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'mix', label: 'What is our work mix?' },
  { id: 'release', label: 'How is release 2.4 going?' },
  { id: 'risk', label: 'What is at risk this sprint?' },
  { id: 'review', label: "What's waiting on a review?" },
  { id: 'people', label: 'Who has the most in progress?' },
];

/**
 * The scripted answer to a question about a chart: built from the context's
 * own figures, never from the sample's. It names the two largest cells and one
 * item in each, then what the model said had moved and what it could not read,
 * so the preview shows what a real answer is held to: the figures in the
 * view, cited by cell, and the gaps said plainly.
 */
export function chartContextParts(context: ViewContext): string[] {
  const cells = context.cells.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const parts = [`${context.title}: the chart holds ${plural(context.cells.length, 'cell')}, ${cells.length} of them with something in.`];
  for (const c of cells.slice(0, 2)) {
    const first = c.items[0];
    parts.push(`${c.rowLabel}, ${c.columnLabel}, holds ${plural(c.count, 'item')} [[cell:${cellCite(c)}]]${first ? `, for example ${cite(first)}` : ''}.`);
  }
  parts.push(context.notable[0] ?? 'Nothing in this chart is flagged as having moved.');
  parts.push(context.coverage[0] ?? 'Everything in the table was read.');
  return parts;
}

/**
 * The scripted briefing for `sample-team` (#567): the recommendation, its reasons and the items under them, worked out from the sample's own
 * records as the starters above are, so the Summary's briefing has a recommendation and reasons that cite real items, as the other sample
 * projects' do. Without it the scripted Analyze answered with no briefing block, and the page said "no Recommendation line".
 */
export function sampleTeamBriefing(): { recommendation: string; reasons: Array<{ lens: string; label: string; line: string; text: string | null; items: Array<{ id: string; why: string; next: string }> }>; onTrack: string; changed: string[]; leftOut: [] } {
  const items = SAMPLE_TEAM.owi.items;
  const current = items.filter((i) => i.iteration?.state === 'current');
  const left = current.filter(open);
  const carried = left.filter((i) => (i.sprints ?? []).length > 1);
  const unestimated = left.filter((i) => !i.estimate);
  const first = carried[0] ?? unestimated[0] ?? left[0] ?? null;
  const prs = SAMPLE_TEAM.owi.changes.filter((c) => c.state === 'OPEN' && c.created).sort((a, b) => Date.parse(a.created!) - Date.parse(b.created!));
  const asOf = Date.parse(SAMPLE_AS_OF);
  const oldest = prs[0] ?? null;
  const waited = oldest ? Math.floor((asOf - Date.parse(oldest.created!)) / DAY) : 0;
  const inProgress = new Map<string, WorkItem[]>();
  for (const i of items.filter((x) => x.statusCategory === 'IN_PROGRESS' && x.assignee)) {
    const who = i.assignee!.name ?? i.assignee!.id;
    inProgress.set(who, [...(inProgress.get(who) ?? []), i]);
  }
  const busiest = [...inProgress.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0] ?? null;
  const reasons: Array<{ lens: string; label: string; line: string; text: string | null; items: Array<{ id: string; why: string; next: string }> }> = [];
  const sprintName = current[0]?.iteration?.name ?? 'The sprint';
  if (left.length > 0) {
    const named = [...carried, ...unestimated.filter((i) => !carried.includes(i))].slice(0, 2);
    reasons.push({
      lens: 'sprint',
      label: 'Sprint',
      line: `${plural(left.length, 'open item')}, ${plural(carried.length, 'carried over', 'carried over')}, ${plural(unestimated.length, 'without an estimate', 'without an estimate')}`,
      text: null,
      items: named.map((i) => ({
        id: i.id,
        why: carried.includes(i) ? `It came over from an earlier sprint and is still open in ${sprintName}.` : `It has no estimate, so ${sprintName}'s points leave it out.`,
        next: carried.includes(i) ? 'Decide whether to finish it, split it or move it out of the sprint.' : 'Estimate it, so the sprint says what is really left.',
      })),
    });
  }
  if (oldest) {
    const unreviewed = prs.filter((c) => c.reviewers.length === 0);
    reasons.push({
      lens: 'waiting',
      label: 'Waiting on review',
      line: `${plural(prs.length, 'pull request')} open, the oldest for ${plural(waited, 'day')}`,
      text: `The oldest, ${cite(oldest.id)}, was opened ${plural(waited, 'day')} ago.${unreviewed[0] ? ` ${cite(unreviewed[0].id)} has no reviewer asked yet.` : ''} Ask for the first review today.`,
      items: [],
    });
  }
  if (busiest) {
    reasons.push({
      lens: 'load',
      label: 'Load',
      line: `${busiest[0]} has ${plural(busiest[1].length, 'item')} in progress`,
      text: null,
      items: [{ id: busiest[1][0]!.id, why: `${busiest[0]} has ${plural(busiest[1].length, 'item')} in progress, the most on the team. This is load, not performance.`, next: 'Check whether something can be handed on or finished before another is started.' }],
    });
  }
  return {
    recommendation: first ? `Settle ${cite(first.id)} first: ${carried.includes(first) ? 'it came over from an earlier sprint' : 'it is open in the running sprint'}, and ${plural(left.length, 'item')} ${left.length === 1 ? 'is' : 'are'} still open in ${sprintName}${oldest ? `. Then ask for a review of ${cite(oldest.id)}, which has waited ${plural(waited, 'day')}` : ''}.` : oldest ? `Ask for a first review of ${cite(oldest.id)}: it has waited ${plural(waited, 'day')}.` : 'Nothing needs anyone right now.',
    reasons,
    onTrack: '',
    changed: [],
    leftOut: [],
  };
}

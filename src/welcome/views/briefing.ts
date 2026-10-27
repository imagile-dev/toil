import type { Brief } from '../../core/brief/brief.js';
import { ok } from '../screens.js';
import { pal, paint } from '../term.js';
import type { Caps, Item, Run, Step, StepResult, View } from '../view.js';

/**
 * Briefing a dossier from the menu (#494): what in its work needs a person,
 * and what to do first, the way `toil dossiers brief` says it, in a terminal.
 * The menu composes the reads a person would type, each shown as it runs:
 * each tracker's issues and each code host's open pull requests, then every
 * open pull request read with its reviews and checks, then `util owi map`,
 * then `dossiers brief`. It asks only what the dossier names (principle 3:
 * the caller composes, and here the menu is the caller). Every key on the
 * briefing is a terminal hyperlink to its tracker where the terminal draws
 * them, and the URL is printed beside it everywhere else. The weekly status
 * report, assembled live, with citations, before anyone asked for it.
 */

/** What `dossiers show` says an area needs, as the briefing reads it. */
type Areas = Record<string, { inputs?: Record<string, unknown> }>;

/** The most open pull requests read in full; a dossier with more is briefed on these, and says so. */
export const MAX_PR_READS = 20;

const isJira = (area: string) => area === 'jira' || area.startsWith('jira-');
const codeHosts = (area: string) => area === 'github' || area === 'bitbucket' || area === 'ado' || area === 'ado-cloud';
/** Each code host's word for an open pull request, as its `pr list --state` takes it. */
const OPEN: Record<string, string> = { github: 'open', bitbucket: 'OPEN', ado: 'active', 'ado-cloud': 'active' };

/** The first run: each tracker's issues and each code host's open pull requests. Azure DevOps work items need a query and a read each, which the menu leaves to Toil UI. */
export function readSteps(dossier: string, areas: Areas): { steps: Step[]; skipped: string[] } {
  const steps: Step[] = [];
  const skipped: string[] = [];
  for (const [area, a] of Object.entries(areas)) {
    const inputs = a.inputs ?? {};
    if (isJira(area) && typeof inputs.project === 'string') {
      steps.push({ args: [area, 'issue', 'search', '--dossier', dossier, '--jql', `project = ${inputs.project} ORDER BY Rank ASC`], label: `The ${inputs.project} issues` });
    }
    if (area === 'github' && typeof inputs.repo === 'string') steps.push({ args: ['github', 'issue', 'list', '--dossier', dossier, '--state', 'all'], label: `${String(inputs.owner ?? '')}/${inputs.repo}'s issues` });
    if (codeHosts(area) && typeof inputs.repo === 'string') steps.push({ args: [area, 'pr', 'list', '--dossier', dossier, '--state', OPEN[area]!], label: `${area}'s open pull requests` });
    if (area.startsWith('ado') && inputs.project) skipped.push(area);
  }
  return { steps, skipped };
}

/** The open pull requests a `pr list` returned, by the id its `pr get` takes. */
function openIds(result: StepResult): string[] {
  if (!result.envelope.ok || result.args[1] !== 'pr') return [];
  const rows = Array.isArray(result.envelope.data) ? (result.envelope.data as Array<Record<string, unknown>>) : [];
  return rows.map((r) => String(r.number ?? r.id ?? r.pullRequestId ?? '')).filter(Boolean);
}

/** Jira's key patterns from the issues a search returned, so pull requests that name a key point at it: `PAY-{n}=corp-jira`. */
function keyPatterns(results: StepResult[]): string[] {
  const out = new Set<string>();
  for (const r of results) {
    if (!r.envelope.ok || r.args[1] !== 'issue' || r.args[2] !== 'search') continue;
    const connection = r.envelope.meta.context?.connection?.value;
    const issues = ((r.envelope.data as { issues?: Array<{ key?: unknown }> } | null)?.issues ?? []).map((i) => String(i.key ?? ''));
    for (const key of issues) {
      const project = /^([A-Z][A-Z0-9]*)-\d+$/.exec(key)?.[1];
      if (project && connection) out.add(`${project}-{n}=${connection}`);
    }
  }
  return [...out];
}

/** The envelopes a run returned, one per line, as `util owi map` and `dossiers brief` read them. */
const lines = (results: StepResult[]) => results.filter((r) => r.envelope.ok).map((r) => JSON.stringify(r.envelope)).join('\n');

/** What the briefing couldn't read, in words, for its screen: failed reads, areas left out, and pull requests past the cap. */
function gaps(results: StepResult[], skipped: string[], capped: string[]): string[] {
  return [
    ...results.filter((r) => !r.envelope.ok).map((r) => `${r.args.slice(0, 3).join(' ')} failed (${r.envelope.ok ? '' : r.envelope.error.code}), so the briefing leaves its work out.`),
    ...skipped.map((a) => `${a} work items aren't read here, since each takes a read of its own: Toil UI reads them.`),
    ...capped,
  ];
}

/** Brief a dossier, from its `dossiers show` data: the four runs, each shown, then the briefing with anything it couldn't read. */
export function briefRun(dossier: string, areas: Areas): Run {
  const { steps, skipped } = readSteps(dossier, areas);
  return {
    title: `Read ${dossier}'s work${skipped.length ? ` (not ${skipped.join(' or ')} work items, which take a read each: Toil UI reads those)` : ''}`,
    steps,
    keepGoing: true,
    next: (read) => {
      const open = read.flatMap((r) => openIds(r).map((id): Step => ({ args: [r.args[0]!, 'pr', 'get', id, '--dossier', dossier, '--include', 'reviews,checks'] })));
      const gets = open.slice(0, MAX_PR_READS);
      const capped = open.length > MAX_PR_READS ? [`The dossier has ${open.length} open pull requests; the first ${MAX_PR_READS} were read in full, the rest only as listed.`] : [];
      const map = (all: StepResult[]): Run => ({
        title: `Map ${dossier}'s work to Open Work Items`,
        steps: [{ args: ['util', 'owi', 'map', '--text', lines(all), ...keyPatterns(all).flatMap((k) => ['--key-pattern', k])] }],
        next: (mapped) => ({
          run: {
            title: `Brief ${dossier}`,
            steps: [{ args: ['dossiers', 'brief', dossier, '--text', lines(mapped)] }],
            next: (briefed) => (briefed[0]?.envelope.ok ? { go: 'dossier-brief', params: { dossier, gaps: JSON.stringify(gaps([...all, ...mapped], skipped, capped)) } } : undefined),
          },
        }),
      });
      return gets.length ? { run: { title: `Read ${dossier}'s open pull requests in full${capped.length ? ` (the first ${MAX_PR_READS} of ${open.length})` : ''}`, steps: gets, keepGoing: true, next: (got) => ({ run: map([...read, ...got]) }) } } : { run: map(read) };
    },
  };
}

/** Text from a service, safe to print: control characters (escape sequences among them) dropped, so a ticket's title can't write to the terminal. */
export function plain(text: string): string {
  return [...text].filter((c) => {
    const n = c.codePointAt(0)!;
    return n >= 0x20 && n !== 0x7f && !(n >= 0x80 && n < 0xa0);
  }).join('');
}

/** A terminal hyperlink (OSC 8) where the terminal draws them, to an http(s) address only; the text alone otherwise, with the URL printed after it by the caller. */
export function link(caps: Caps, text: string, url: string | null): string {
  if (!url || !caps.hyperlinks || !/^https?:\/\//i.test(url) || plain(url) !== url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** `[[corp-jira:PAY-101]]` as its key, linked: the briefing's citations, items and pull requests alike, as a terminal shows them. */
function cited(caps: Caps, text: string, urls: ReadonlyMap<string, string | null>): string {
  return plain(text).replace(/\[\[([^\]]+)\]\]/g, (_m, id: string) => link(caps, id.slice(id.indexOf(':') + 1), urls.get(id) ?? null));
}

/** The briefing, as lines: the recommendation, each reason with its items, what's on track, which lenses couldn't check, and what wasn't read. */
export function briefingLines(caps: Caps, b: Brief & { dossier?: { name: string } }, notRead: readonly string[] = []): string[] {
  const p = pal(caps);
  const items = b.reasons.flatMap((r) => r.items);
  const byId = new Map<string, string | null>([...items.map((i): [string, string | null] => [i.id, i.url]), ...items.flatMap((i) => i.changes.map((c): [string, string | null] => [c.id, c.url]))]);
  const out: string[] = [];
  out.push(paint(caps, p.muted, `Briefed by code as of ${b.asOf.slice(0, 16).replace('T', ' ')} UTC${b.sprint ? `, ${plain(b.sprint.name)}` : ''}`));
  for (const n of notRead) out.push(ok(caps, false, plain(n)));
  out.push('');
  out.push(b.recommendation ? cited(caps, b.recommendation.text, byId) : 'Nothing needs anyone right now.');
  for (const r of b.reasons) {
    out.push('', `${ok(caps, r.severity !== 'danger', r.label)}  ${paint(caps, p.muted, plain(r.line))}`);
    if (r.text) out.push(`  ${cited(caps, r.text, byId)}`);
    for (const i of r.items) {
      out.push(`  ${link(caps, plain(i.key), i.url)}  ${plain(i.title)}${i.assignee ? paint(caps, p.faint, `  ${plain(i.assignee)}`) : ''}`);
      out.push(`    ${paint(caps, p.muted, cited(caps, i.why, byId))}`);
      if (i.url && !caps.hyperlinks) out.push(`    ${paint(caps, p.faint, plain(i.url))}`);
    }
  }
  out.push('', paint(caps, p.muted, `On track: ${b.onTrack.open} open, ${b.onTrack.done} done.`));
  for (const l of b.lenses.filter((x) => x.on && x.note)) out.push(paint(caps, p.faint, `${l.label}: ${l.note}`));
  return out;
}

/** The briefing screen: the latest `dossiers brief` this session ran for the dossier, what it couldn't read, and the way to run it again. */
export const briefView: View = {
  title: () => 'Briefing',
  body: (caps, p) => {
    const b = p.session.briefs?.[p.frame.params.dossier ?? ''];
    if (!b) return ['No briefing yet: Brief this dossier reads it.'];
    let notRead: string[] = [];
    try {
      notRead = JSON.parse(p.frame.params.gaps ?? '[]') as string[];
    } catch {
      // A frame from before gaps were kept: nothing to add.
    }
    return briefingLines(caps, b as Brief, notRead);
  },
  items: (p) => {
    const dossier = p.frame.params.dossier ?? '';
    const shown = p.session.dossiers?.[dossier]?.show as { areas?: Areas } | undefined;
    const again: Item[] = shown?.areas ? [{ label: 'Brief it again', hint: 'Read its work again, then brief it', action: { run: briefRun(dossier, shown.areas) } }] : [];
    return [...again, { label: 'Back', hint: '', action: { back: true } }];
  },
};

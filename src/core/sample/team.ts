import { OVERRIDABLE, OWI_VERSION, dimensionMap, documentsFrom, fieldOverrides, keyPatterns, mapOwi, type Change, type OrphanHistory, type WorkItem } from '../owi/index.js';
import { buildFacts, type SampleFacts } from './facts.js';
import { buildJira, FIELD, PROJECT } from './jira.js';
import { dayStart } from './kit.js';
import { PEOPLE } from './people.js';
import { buildPrs, OWNER, REPO } from './prs.js';

/**
 * The sample team: a web shop's team of eight people and an AI agent, six
 * sprints and three releases of its work, as the trackers print it, mapped
 * with the same functions `toil util owi map` runs. It lets toil be tried on a
 * fresh install with no connection and no sync, the way an evaluation is
 * supposed to go and, in practice, almost never does. Everything here is a
 * pure function of one day: no clock, no file, no network.
 */

export const CONNECTIONS = { jira: 'sample-jira', github: 'sample-github' } as const;
export const SAMPLE_NAME = 'sample-team';

export interface SampleOwi {
  owi: typeof OWI_VERSION;
  count: number;
  items: WorkItem[];
  changes: Change[];
  histories: OrphanHistory[];
  unmapped: Record<string, number>;
  skipped: never[];
}

export interface SampleTeam {
  asOf: string;
  /** `toil jira issue search --changelog`'s data. */
  jira: { startAt: number; maxResults: number; total: number; issues: Array<Record<string, unknown>> };
  /** Each pull request as `toil github pr get --include reviews,checks,commits,files` prints it. */
  prs: Array<Record<string, unknown>>;
  /** The toil project file's content. */
  toilProject: Record<string, unknown>;
  /** What `toil util owi map` returns for the two above, without its `verified`. */
  owi: SampleOwi;
  facts: SampleFacts;
}

const VERSION = '0.0.0-sample';

const envelope = (command: string, data: unknown, connection: string, inputs: Record<string, string>) => ({
  ok: true,
  data,
  error: null,
  meta: {
    command,
    durationMs: 1,
    version: VERSION,
    context: {
      connection: { value: connection, source: 'default', default: 'named' },
      inputs: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { value, source: 'toil-project' }])),
    },
  },
});

/** The toil project file for the team: which tracker and repository it works in, who is on it, and what to split by. */
export function sampleToilProject(): Record<string, unknown> {
  return {
    name: SAMPLE_NAME,
    description: 'A web shop team for trying toil: two teams, six sprints, three releases and an AI agent, with no connection to set up.',
    repos: [{ name: REPO, remotes: [`https://github.imagile.dev/${OWNER}/${REPO}.git`] }],
    jira: {
      connection: CONNECTIONS.jira,
      project: PROJECT,
      fields: {
        estimate: FIELD.points,
        iteration: FIELD.sprint,
        epicLink: FIELD.epicLink,
        customer: FIELD.customer,
      },
    },
    github: { connection: CONNECTIONS.github, owner: OWNER, repo: REPO },
    people: PEOPLE.map((p) => ({ name: p.name, ...(p.kind === 'agent' ? { kind: 'agent' } : {}), team: p.team, ids: { jira: p.jira, github: p.github } })),
    wipLimit: 3,
    dimensions: { customer: { jira: FIELD.customer } },
    classify: { scheme: 'ktlo-feature' },
  };
}

export function sampleTeam(asOf: string): SampleTeam {
  const base = dayStart(asOf);
  const jira = buildJira(base);
  const prs = buildPrs(base, jira.placed);
  const toilProject = sampleToilProject();

  // The way Toil UI reads a search with its changelog: the search without it, and each history as its own envelope.
  const search = envelope('jira issue search', { ...jira.data, issues: jira.data.issues.map(({ changelog: _history, ...issue }) => issue) }, CONNECTIONS.jira, { project: PROJECT });
  const histories = jira.data.issues.map((issue) => ({
    key: issue.key as string,
    history: envelope('jira issue history', (issue.changelog as { histories: unknown[] }).histories, CONNECTIONS.jira, { project: PROJECT }),
  }));
  const pulls = prs.map((pr) => envelope('github pr get', pr, CONNECTIONS.github, { owner: OWNER, repo: REPO }));

  const { documents, skipped } = documentsFrom([search, ...histories, ...pulls]);
  const fields = fieldOverrides(overridesOf((toilProject.jira as { fields: Record<string, string> }).fields));
  const mapped = mapOwi(documents, {
    fields,
    skipped,
    dimensions: dimensionMap(toilProject.dimensions),
    keys: keyPatterns([`${PROJECT}-{n}=${CONNECTIONS.jira}`]),
  });
  if (mapped.warnings.length > 0 || mapped.skipped.length > 0) {
    throw new Error(`The sample team did not map cleanly: ${[...mapped.warnings.map((w) => w.message), ...mapped.skipped.map((s) => s.reason)].join('; ')}`);
  }

  const owi: SampleOwi = { owi: OWI_VERSION, count: mapped.items.length, items: mapped.items, changes: mapped.changes, histories: [], unmapped: {}, skipped: [] };
  const facts = buildFacts({ asOf: new Date(Date.parse(asOf)).toISOString(), base, jira, owi, wipLimit: toilProject.wipLimit as number });
  return {
    asOf: facts.asOf,
    jira: jira.data as SampleTeam['jira'],
    prs,
    toilProject,
    owi,
    facts,
  };
}

/** The part of a toil project's `fields` that points an OWI field at a tracker field, the way Toil UI reads it. */
function overridesOf(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => (OVERRIDABLE as readonly string[]).includes(name)));
}

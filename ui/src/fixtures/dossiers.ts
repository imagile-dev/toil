/**
 * The preview's three dossiers, as the files in `~/.toil/dossiers/` would hold
 * them, and what `toil dossiers list` and `toil dossiers show` print for them.
 * Each mixes its own sources, the way real teams do:
 *
 * - **card-payments**: Jira Data Center (PAY), Bitbucket Data Center
 *   (PAY/payments-core) with Jenkins multibranch builds, and OpenShift for dev
 *   and prod.
 * - **settlement**: Azure DevOps Server (DefaultCollection/Payments): Boards,
 *   Azure Repos (settlement) and two Azure Pipelines, one for CI and one that
 *   deploys.
 * - **checkout-web**: GitHub Enterprise (imagile/payments-web) with Projects
 *   (project 7) and Actions checks, and OpenShift for staging and prod.
 *
 * Reference data (`jobs`, `builds`, `deployments`, `projects`) is the kind a
 * dossier keeps as written (docs/dossiers.md); the dashboard reads it to know
 * which pipelines and boards to ask about. Every host is a placeholder.
 * Three dossiers, each complete, which is two more than most handovers produce.
 */

export interface DossierFile {
  name: string;
  description: string;
  env?: string;
  repos: Array<{ name: string; remotes: string[] }>;
  environments?: Record<string, Record<string, Record<string, unknown>>>;
  [area: string]: unknown;
}

export const DOSSIERS: DossierFile[] = [
  {
    name: 'card-payments',
    description: 'Card payments v2: tokenised cards at the edge. Jira, Bitbucket, Jenkins and OpenShift.',
    env: 'dev',
    repos: [{ name: 'payments-core', remotes: ['ssh://git@bitbucket.imagile.dev:7999/pay/payments-core.git'] }],
    jira: { connection: 'corp-jira', project: 'PAY' },
    bitbucket: { connection: 'corp-bitbucket', project: 'PAY', repo: 'payments-core' },
    jenkins: { connection: 'corp-jenkins', jobs: ['payments-core'] },
    environments: {
      dev: { openshift: { connection: 'ocp-nonprod', namespace: 'payments-dev' } },
      prod: { openshift: { connection: 'ocp-prod', namespace: 'payments-prod' } },
    },
  },
  {
    name: 'settlement',
    description: 'Daily settlement reports for finance. Azure DevOps Server: Boards, Repos and Pipelines.',
    repos: [{ name: 'settlement', remotes: ['https://ado.imagile.dev/DefaultCollection/Payments/_git/settlement'] }],
    ado: { connection: 'corp-ado', collection: 'DefaultCollection', project: 'Payments', repo: 'settlement', builds: ['settlement-ci'], deployments: ['settlement-deploy'] },
  },
  {
    name: 'checkout-web',
    description: 'The checkout web front end. GitHub Enterprise with Projects and Actions, deployed on OpenShift.',
    env: 'staging',
    repos: [{ name: 'payments-web', remotes: ['https://ghe.imagile.dev/imagile/payments-web.git'] }],
    github: { connection: 'github', owner: 'imagile', repo: 'payments-web', projects: ['7'] },
    environments: {
      staging: { openshift: { connection: 'ocp-nonprod', namespace: 'checkout-staging' } },
      prod: { openshift: { connection: 'ocp-prod', namespace: 'checkout-prod' } },
    },
  },
];

const USER_DIR = '/home/you/.toil/dossiers';
export const fileOf = (name: string) => `${USER_DIR}/${name}.json`;

/** Each area's context inputs, as `dossiers show` resolves them: the ones the registry declares, nothing else. */
const CONTEXT: Record<string, string[]> = {
  jira: ['project'],
  bitbucket: ['project', 'repo'],
  jenkins: ['instance'],
  ado: ['collection', 'organization', 'project', 'repo'],
  github: ['owner', 'repo'],
  openshift: ['instance'],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `toil dossiers show <name>`'s data. */
export function showData(d: DossierFile) {
  const { name, description, env, repos, environments, ...sections } = d;
  const areaNames = new Set([...Object.keys(sections), ...Object.values(environments ?? {}).flatMap((e) => Object.keys(e))]);
  const areas: Record<string, unknown> = {};
  for (const area of [...areaNames].sort()) {
    const section = (env !== undefined ? environments?.[env]?.[area] : undefined) ?? (isRecord(sections[area]) ? sections[area] : {});
    const inputs = Object.fromEntries((CONTEXT[area] ?? []).flatMap((k) => (typeof section[k] === 'string' ? [[k, section[k]]] : [])));
    areas[area] = {
      connection: typeof section.connection === 'string' ? { value: section.connection, source: 'dossier' } : null,
      writes: false,
      env: area === 'openshift' ? (env ?? null) : null,
      inputs,
    };
  }
  return {
    name,
    source: 'user',
    file: fileOf(name),
    by: 'input',
    match: null,
    repo: null,
    adopted: true,
    areas,
    dossier: { name, description, ...(env ? { env } : {}), repos, ...sections, ...(environments ? { environments } : {}) },
    problems: [],
  };
}

/** `toil dossiers list`'s data. */
export function listData() {
  return {
    folder: null,
    places: { user: USER_DIR, listed: [], repo: null },
    dossiers: DOSSIERS.map((d) => ({ name: d.name, description: d.description, source: 'user', file: fileOf(d.name), shadowedBy: null, problems: 0 })),
    broken: [],
  };
}

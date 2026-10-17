// Every integration, rendered on /integrations/ and counted on the homepage.
// Mirrors docs/integrations.md; update both together. Command names follow
// docs/command-contract.md. Each status is the integration's verification
// level once its code is on main, and `planned` until then.

export type Status = 'planned' | 'unit' | 'integration' | 'live';

export interface Integration {
  area: string;
  name: string;
  covers: string;
  credential: string;
  status: Status;
  /** SaaS only: the vendor's own API host, shown in examples instead of a self-hosted placeholder. */
  host?: string;
  /** Credential env keys, when the area takes more than one token. Defaults to TOKEN. */
  keys?: string[];
}

export interface Group {
  title: string;
  blurb: string;
  items: Integration[];
}

export const groups: Group[] = [
  {
    title: 'Work tracking and source',
    blurb: 'Where the work is described, discussed and reviewed.',
    items: [
      { area: 'jira', name: 'Jira Data Center', covers: 'Issues, search, transitions, comments, worklogs, attachments, custom fields, boards, sprints', credential: 'Personal access token', status: 'unit', keys: ['API_TOKEN'] },
      { area: 'ado', name: 'Azure DevOps Server', covers: 'Work items, repos, pull requests, pipelines', credential: 'Personal access token', status: 'planned' },
      { area: 'bitbucket', name: 'Bitbucket Data Center', covers: 'Repositories, pull requests, comments, builds', credential: 'HTTP access token', status: 'planned' },
      { area: 'github', name: 'GitHub & GitHub Enterprise', covers: 'Pull requests, reviews, issues, checks', credential: 'Fine-grained PAT', status: 'planned', host: 'https://ghe.imagile.dev' },
      { area: 'confluence', name: 'Confluence Data Center', covers: 'Pages, spaces, search, attachments', credential: 'Personal access token', status: 'planned' },
      { area: 'git', name: 'Local git', covers: 'Status, diff, log, branch, current PR', credential: 'None — local', status: 'planned' },
    ],
  },
  {
    title: 'Build, release and runtime',
    blurb: 'Where code becomes something running.',
    items: [
      { area: 'jenkins', name: 'Jenkins', covers: 'Jobs, builds, console logs, queue', credential: 'API token', status: 'planned' },
      { area: 'artifactory', name: 'JFrog Artifactory', covers: 'Repositories, artifact search, versions, licenses', credential: 'Access token', status: 'planned' },
      { area: 'openshift', name: 'OpenShift / Kubernetes', covers: 'Pods, events, logs, metrics, deployments', credential: 'Service account token', status: 'planned' },
      { area: 'splitio', name: 'Split.IO', covers: 'Feature flags, environments, change requests', credential: 'Admin API key', status: 'planned', host: 'https://api.split.io' },
      { area: 'saucelabs', name: 'Sauce Labs', covers: 'Test jobs, builds, real devices', credential: 'Access key', status: 'planned', host: 'https://api.us-west-1.saucelabs.com', keys: ['USERNAME', 'ACCESS_KEY'] },
    ],
  },
  {
    title: 'Security and quality',
    blurb: 'The scanners and gates every change has to clear.',
    items: [
      { area: 'sonar', name: 'SonarQube', covers: 'Quality gates, issues, hotspots, measures', credential: 'User token', status: 'planned' },
      { area: 'checkmarx', name: 'Checkmarx One', covers: 'SAST scans, results, projects', credential: 'API key, exchanged over HTTP', status: 'planned', host: 'https://eu.ast.checkmarx.net', keys: ['API_KEY'] },
      { area: 'contrast', name: 'Contrast Security', covers: 'Applications, vulnerabilities, routes', credential: 'API key + service key', status: 'planned', keys: ['API_KEY', 'SERVICE_KEY'] },
      { area: 'sonatypeiq', name: 'Sonatype IQ Server', covers: 'Applications, policy evaluations, violations, waivers', credential: 'User token pair', status: 'planned', keys: ['USER_CODE', 'PASSCODE'] },
      { area: 'sde', name: 'SD Elements', covers: 'Projects, countermeasures, security requirements', credential: 'API token', status: 'planned' },
    ],
  },
  {
    title: 'Observability',
    blurb: 'What production is actually doing.',
    items: [
      { area: 'dynatrace', name: 'Dynatrace', covers: 'Problems, entities, traces, metrics', credential: 'API token', status: 'planned' },
      { area: 'logscale', name: 'Falcon LogScale', covers: 'Log queries, repositories, saved searches', credential: 'API token', status: 'planned' },
      { area: 'elasticsearch', name: 'Elasticsearch', covers: 'Search, count, indices, cluster health', credential: 'API key', status: 'planned' },
      { area: 'kibana', name: 'Kibana', covers: 'Dashboards, data views, alerting rules', credential: 'API key', status: 'planned' },
    ],
  },
  {
    title: 'Design and data',
    blurb: 'The context engineers pull in from outside the code.',
    items: [
      { area: 'figma', name: 'Figma', covers: 'Files from a link, comments, version history', credential: 'Personal access token', status: 'planned', host: 'https://api.figma.com' },
      { area: 'alation', name: 'Alation', covers: 'Catalog metadata, search, documents', credential: 'Refresh token, exchanged over HTTP', status: 'planned', keys: ['REFRESH_TOKEN'] },
    ],
  },
];

export interface DepsCommand {
  command: string;
  source: string;
  covers: string;
  network: string;
}

export const depsCommands: DepsCommand[] = [
  { command: 'toil deps scan', source: 'Local manifests', covers: 'Package inventory for npm, Maven and NuGet', network: 'None' },
  { command: 'toil deps diff', source: 'Local manifests', covers: 'Packages added, removed or changed between two refs', network: 'None' },
  { command: 'toil osv vulns', source: 'OSV.dev', covers: 'Known vulnerabilities for an inventory', network: 'Public API' },
  { command: 'toil ossindex vulns', source: 'Sonatype OSS Index', covers: 'Known vulnerabilities for an inventory', network: 'Public API' },
  { command: 'toil sonatypeiq evaluate', source: 'Sonatype IQ Server', covers: 'Policy evaluation against an application', network: 'Your server' },
  { command: 'toil deps frisk --source <one>', source: 'The source you name', covers: 'Alias for the matching command above', network: 'As above' },
  { command: 'toil deps outdated', source: 'JFrog Artifactory', covers: 'Newer versions in your mirrors', network: 'Your server' },
  { command: 'toil deps license-check', source: 'JFrog Artifactory', covers: 'License metadata for an inventory', network: 'Your server' },
];

export const notPlanned = [
  { name: 'ServiceNow', why: 'Personal access tokens are opt-in and usually disabled, so in practice sign-in falls back to a username and password.' },
  { name: 'IBM UrbanCode Deploy', why: 'There is no standalone personal token; the only workable sign-in is an account password.' },
];

export const integrationCount = groups.reduce((n, g) => n + g.items.length, 0);

/** Integrations whose code has shipped, at any verification level. */
export const shippedCount = groups.reduce((n, g) => n + g.items.filter((i) => i.status !== 'planned').length, 0);

/**
 * Where a user generates each integration's credential, for its docs page. Only
 * paths we're confident of; anything absent gets a generic line rather than a
 * guess that sends someone clicking round the wrong menu.
 */
export const credentialWhere: Record<string, string> = {
  jira: 'Your profile picture → Profile → Personal Access Tokens',
  confluence: 'Your profile picture → Settings → Personal Access Tokens',
  bitbucket: 'Your profile picture → Manage account → HTTP access tokens',
  github: 'Settings → Developer settings → Personal access tokens → Fine-grained tokens',
  ado: 'User settings → Personal access tokens',
  sonar: 'My Account → Security → Generate Tokens',
  jenkins: 'Your user name → Security → API Token',
  artifactory: 'Your profile → Edit Profile → Generate an Identity Token',
  dynatrace: 'Access tokens → Generate new token',
  elasticsearch: 'Kibana → Stack Management → API keys',
  kibana: 'Stack Management → API keys',
  figma: 'Settings → Security → Personal access tokens',
  saucelabs: 'User settings → Access key',
};

export interface IntegrationEntry extends Integration {
  group: string;
}

/** Every integration, flattened, in board order. */
export const allIntegrations: IntegrationEntry[] = groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.title })));

/** The env var prefix for an area: jira-cloud -> TOIL_JIRA_CLOUD_. */
export function envPrefix(area: string): string {
  return `TOIL_${area.toUpperCase().replace(/-/g, '_')}_`;
}

export const statusMeaning: Record<Status, string> = {
  planned: 'Designed and scheduled. No code has shipped yet, so the details below describe the plan.',
  unit: 'Shipped, with its logic tested against stubbed HTTP. Not yet run against a real instance in CI.',
  integration: 'Automated tests pass against a real instance in CI.',
  live: "In day-to-day use against a real organization's instance.",
};

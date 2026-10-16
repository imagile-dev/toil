// The planned integrations, rendered on /integrations/ and counted on the
// homepage. Mirrors docs/integrations.md; update both together. Command
// names follow docs/command-contract.md.

export type Status = 'planned' | 'unit' | 'integration' | 'live';

export interface Integration {
  area: string;
  name: string;
  covers: string;
  credential: string;
  status: Status;
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
      { area: 'jira', name: 'Jira Data Center', covers: 'Issues, sprints, boards, projects, transitions, comments', credential: 'Personal access token', status: 'planned' },
      { area: 'ado', name: 'Azure DevOps Server', covers: 'Work items, repos, pull requests, pipelines', credential: 'Personal access token', status: 'planned' },
      { area: 'bitbucket', name: 'Bitbucket Data Center', covers: 'Repositories, pull requests, comments, builds', credential: 'HTTP access token', status: 'planned' },
      { area: 'github', name: 'GitHub & GitHub Enterprise', covers: 'Pull requests, reviews, issues, checks', credential: 'Fine-grained PAT', status: 'planned' },
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
      { area: 'splitio', name: 'Split.IO', covers: 'Feature flags, environments, change requests', credential: 'Admin API key', status: 'planned' },
      { area: 'saucelabs', name: 'Sauce Labs', covers: 'Test jobs, builds, real devices', credential: 'Access key', status: 'planned' },
    ],
  },
  {
    title: 'Security and quality',
    blurb: 'The scanners and gates every change has to clear.',
    items: [
      { area: 'sonar', name: 'SonarQube', covers: 'Quality gates, issues, hotspots, measures', credential: 'User token', status: 'planned' },
      { area: 'checkmarx', name: 'Checkmarx One', covers: 'SAST scans, results, projects', credential: 'API key, exchanged over HTTP', status: 'planned' },
      { area: 'contrast', name: 'Contrast Security', covers: 'Applications, vulnerabilities, routes', credential: 'API key + service key', status: 'planned' },
      { area: 'sonatypeiq', name: 'Sonatype IQ Server', covers: 'Applications, policy evaluations, violations, waivers', credential: 'User token pair', status: 'planned' },
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
      { area: 'figma', name: 'Figma', covers: 'Files from a link, comments, version history', credential: 'Personal access token', status: 'planned' },
      { area: 'alation', name: 'Alation', covers: 'Catalog metadata, search, documents', credential: 'Refresh token, exchanged over HTTP', status: 'planned' },
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

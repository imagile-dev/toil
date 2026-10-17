// Every integration, rendered on /integrations/ and counted on the homepage.
// Each one is its own file, integrations/<area>.json, so a port changes its own
// row (status, supported version) without touching anyone else's. This module
// gathers them into the board's groups. Command names follow
// docs/command-contract.json. Each status is the integration's verification
// level once its code is on main, and `planned` until then.

export type Status = 'planned' | 'unit' | 'integration' | 'live';

/** The oldest server or API version an integration supports. `minimum: null` means it hasn't been established. */
export interface SupportedVersion {
  product: string;
  minimum: string | null;
  /** The API version that minimum speaks, e.g. `REST API 7.1`. */
  api?: string;
  note?: string;
}

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
  /** Where in the vendor's UI the credential is made. Only paths we're sure of. */
  credentialWhere?: string;
  /** A fact about the credential worth a line in docs/integrations.md (a CI fallback, a shared key). */
  credentialNote?: string;
  supported?: SupportedVersion;
}

/** One integrations/<area>.json file. */
interface IntegrationFile extends Integration {
  group: GroupId;
  /** Position within its group on the board. */
  order: number;
}

export interface Group {
  title: string;
  blurb: string;
  items: Integration[];
}

type GroupId = 'work' | 'build' | 'security' | 'observability' | 'design';

const groupInfo: Array<{ id: GroupId; title: string; blurb: string }> = [
  { id: 'work', title: 'Work tracking and source', blurb: 'Where the work is described, discussed and reviewed.' },
  { id: 'build', title: 'Build, release and runtime', blurb: 'Where code becomes something running.' },
  { id: 'security', title: 'Security and quality', blurb: 'The scanners and gates every change has to clear.' },
  { id: 'observability', title: 'Observability', blurb: 'What production is actually doing.' },
  { id: 'design', title: 'Design and data', blurb: 'The context engineers pull in from outside the code.' },
];

const files = Object.values(import.meta.glob<IntegrationFile>('./integrations/*.json', { eager: true, import: 'default' }));

export const groups: Group[] = groupInfo.map(({ id, title, blurb }) => ({
  title,
  blurb,
  items: files
    .filter((f) => f.group === id)
    .sort((a, b) => a.order - b.order || a.area.localeCompare(b.area))
    .map(({ group: _group, order: _order, ...item }) => item),
}));

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
export const credentialWhere: Record<string, string> = Object.fromEntries(files.flatMap((f) => (f.credentialWhere ? [[f.area, f.credentialWhere]] : [])));

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

/** `Azure DevOps Server 2022.1 or later (REST API 7.1)`, or that the minimum isn't established. Worded as src/core/supported.ts words it. */
export function supportedText(s: SupportedVersion): string {
  if (s.minimum === null) return `The oldest ${s.product} version toil supports hasn't been established`;
  return `${s.product} ${s.minimum} or later${s.api ? ` (${s.api})` : ''}`;
}

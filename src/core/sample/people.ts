/**
 * The nine people on the sample team, and the accounts they hold in Jira and
 * GitHub. Two teams, Storefront and Platform, and one member that is an AI
 * agent, which is a member like any other until it needs leave. Every name is
 * an initial and a surname, and every address is the one the documentation
 * reserves for people who do not exist.
 */

export type TeamName = 'Storefront' | 'Platform';

export interface Person {
  /** The key this folder uses for them. */
  key: string;
  name: string;
  team: TeamName;
  kind: 'human' | 'agent';
  /** Their Jira user name. */
  jira: string;
  /** Their GitHub login. */
  github: string;
}

export const PEOPLE: readonly Person[] = [
  { key: 'js', name: 'J. Smith', team: 'Storefront', kind: 'human', jira: 'jsmith', github: 'jsmith-dev' },
  { key: 'ac', name: 'A. Chen', team: 'Storefront', kind: 'human', jira: 'achen', github: 'achen-dev' },
  { key: 'rp', name: 'R. Patel', team: 'Storefront', kind: 'human', jira: 'rpatel', github: 'rpatel-dev' },
  { key: 'ml', name: 'M. Lind', team: 'Storefront', kind: 'human', jira: 'mlind', github: 'mlind-dev' },
  { key: 'kn', name: 'K. Nakamura', team: 'Storefront', kind: 'human', jira: 'knakamura', github: 'knakamura-dev' },
  { key: 'do', name: 'D. Okafor', team: 'Platform', kind: 'human', jira: 'dokafor', github: 'dokafor-dev' },
  { key: 'sg', name: 'S. Garcia', team: 'Platform', kind: 'human', jira: 'sgarcia', github: 'sgarcia-dev' },
  { key: 'tn', name: 'T. Novak', team: 'Platform', kind: 'human', jira: 'tnovak', github: 'tnovak-dev' },
  { key: 'ag', name: 'Copilot', team: 'Platform', kind: 'agent', jira: 'copilot-agent', github: 'copilot-swe-agent[bot]' },
];

export const byKey = (key: string): Person => {
  const found = PEOPLE.find((p) => p.key === key);
  if (!found) throw new Error(`The sample team has no person "${key}".`);
  return found;
};

export const STOREFRONT = PEOPLE.filter((p) => p.team === 'Storefront' && p.kind === 'human');
export const PLATFORM = PEOPLE.filter((p) => p.team === 'Platform' && p.kind === 'human');

/** The dependency bot that opens bump tickets and pull requests, which belongs to nobody on the roll. */
export const RENOVATE = { jira: 'svc-renovate', name: 'Renovate Bot', github: 'renovate[bot]' };

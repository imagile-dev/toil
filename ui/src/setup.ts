/**
 * The setup wizard's pure parts (#561): its six steps, and how the registry's
 * areas are sorted into the tools most people use and the long tail behind
 * "more". Nothing here reads or changes anything. Form 27-B, stripped of its
 * boxes, and filed as one array.
 */

import type { AreaInfo } from './config.ts';

export const SETUP_STEPS = ['welcome', 'tools', 'connect', 'project', 'helper', 'done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** The step titles, as the progress line and each screen's heading say them. */
export const STEP_TITLE: Record<SetupStep, string> = {
  welcome: 'Welcome',
  tools: 'Which tools do you use?',
  connect: 'Link your tools',
  project: 'Your Toil project',
  helper: 'An AI helper (optional)',
  done: 'All set',
};

/** The work-tracking and code tools most people reach for, in the order the list shows them. */
export const COMMON_AREAS = ['github', 'jira', 'ado', 'bitbucket', 'confluence', 'sonarqube'] as const;

const NAMES: Record<string, string> = { github: 'GitHub', jira: 'Jira', ado: 'Azure DevOps', bitbucket: 'Bitbucket', confluence: 'Confluence', sonarqube: 'SonarQube', jenkins: 'Jenkins', openshift: 'OpenShift' };

/** What an area is called to a person: its product name where toil knows it, else the area's own name. */
export const toolName = (area: string): string => NAMES[area] ?? area;

/** Only an area whose connection says what it holds can be added from a page. */
export const connectable = (areas: AreaInfo[]): AreaInfo[] => areas.filter((a) => a.connection.length > 0);

/** The areas split into the common ones, in the order above, and the rest, A to Z. */
export function groupAreas(areas: AreaInfo[]): { common: AreaInfo[]; more: AreaInfo[] } {
  const usable = connectable(areas);
  const common = COMMON_AREAS.flatMap((n) => usable.filter((a) => a.name === n));
  const more = usable.filter((a) => !(COMMON_AREAS as readonly string[]).includes(a.name)).sort((a, b) => a.name.localeCompare(b.name));
  return { common, more };
}

/** `toil connections add corp-jira --area jira`, for the person who would rather type it on a terminal. */
export const terminalAdd = (name: string, area: string): string => `toil connections add ${name || '<name>'} --area ${area}`;

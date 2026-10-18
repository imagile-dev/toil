/**
 * The scripted Agent: canned answers about the fixture sprint, each citing the
 * items it rests on, which is the behaviour the preview exists to show. Nothing
 * here calls a model. test/agent.test.ts holds every figure and citation to
 * what src/model/ computes from the same fixture, so the script can't drift
 * from the data. The answers were approved in advance, which is more than most
 * status reports can say.
 */

import type { Agent, Answer, AnswerPart, Starter } from '../agent.ts';
import { citationsOf } from '../agent.ts';

const J = (n: number) => `[[corp-jira:PAY-${n}]]`;
const A = (n: number) => `[[corp-ado:${n}]]`;
const G = (n: number) => `[[github:imagile/payments-web#${n}]]`;

export const SCRIPT: Record<string, { label: string; parts: string[] }> = {
  risk: {
    label: 'Why is this sprint at risk?',
    parts: [
      `It is day 7 of 10, 5 of 48 points are done and 43 remain, so most of the work has to land in three days.`,
      `Two blocked chains hold 14 points back. ${J(103)} waits on ${J(102)}, which waits on ${J(101)}, and ${J(101)}'s latest build failed. In Azure DevOps, ${A(2303)} can't start until ${A(2302)} is done.`,
      `Scope grew by 4 items and 7 points after the sprint started: ${J(107)}, ${A(2306)}, ${G(43)} and ${G(45)}. ${G(43)} also has a failing check.`,
      `${J(104)} and ${A(2304)} came over from Sprint 41 and are still open.`,
    ],
  },
  standup: {
    label: 'Give me a stand-up digest',
    parts: [
      `Since yesterday's stand-up: ${G(44)} closed after its pull request merged with green checks.`,
      `${J(101)} has a pull request open, but its build failed, and ${J(102)} and ${J(103)} are queued behind it.`,
      `${A(2302)} has a pull request open with a build still running. ${G(42)} is in review with checks passing, and ${G(43)}'s draft fails its Safari check.`,
      `Not started and unassigned: ${J(103)}, ${J(107)}, ${A(2303)}, ${A(2306)} and ${G(45)}.`,
    ],
  },
  hygiene: {
    label: "What's unestimated or orphaned?",
    parts: [
      `Unestimated: ${J(107)} and ${G(45)}. Both were added after the sprint started.`,
      `Orphaned, with no parent epic or feature: ${J(107)}, ${A(2306)} and ${G(45)}.`,
      `${J(106)} has no estimate either, but it is a sub-task of ${J(101)}, which does, so it isn't counted.`,
    ],
  },
};

const UNSCRIPTED = 'This preview answers only its starter questions. The released app sends your question to the agent your organization approved.';

export function scriptedAgent(): Agent {
  return {
    starters: (): Starter[] => Object.entries(SCRIPT).map(([id, s]) => ({ id, label: s.label })),
    async ask(prompt: string): Promise<Answer> {
      const entry = SCRIPT[prompt] ?? Object.values(SCRIPT).find((s) => s.label === prompt);
      const parts: AnswerPart[] = (entry?.parts ?? [UNSCRIPTED]).map((text) => ({ text }));
      return { prompt: entry?.label ?? prompt, parts, citations: citationsOf(parts), by: 'scripted' };
    },
  };
}

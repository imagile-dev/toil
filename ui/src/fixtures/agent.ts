/**
 * The scripted Agent: canned answers about each dossier, citing the work
 * items they rest on, with the pull requests, builds and deployments named by
 * the ids the commands returned. Nothing here calls a model. test/agent.test.ts
 * recomputes every figure and citation from what the dashboard loads through
 * the fixture `execute()`, so the script can't drift from the data. The
 * answers were approved in advance, which is more than most status reports can
 * say.
 */

import type { Agent, Answer, AnswerPart, Starter } from '../agent.ts';
import { citationsOf } from '../agent.ts';

const J = (n: number) => `[[corp-jira:PAY-${n}]]`;
const A = (n: number) => `[[corp-ado:${n}]]`;
const G = (n: number) => `[[github:imagile/payments-web#${n}]]`;

export interface Script {
  label: string;
  parts: string[];
}

export const SCRIPTS: Record<string, Record<string, Script>> = {
  'card-payments': {
    risk: {
      label: "What's at risk in this dossier?",
      parts: [
        `It is day 7 of 10 of Sprint 42: 3 of 21 points are done and 18 remain.`,
        `${J(101)}'s pull request #311 fails its Jenkins build, and ${J(102)} and ${J(103)} are blocked behind it, holding 11 points back.`,
        `${J(104)} came over from Sprint 41 and its pull request #305 is still open. ${J(107)} was added after the sprint started, with no estimate.`,
      ],
    },
    deployed: {
      label: 'Where is this work deployed?',
      parts: [
        `The dev environment runs payments-core 1.14.0 (4e1d2a9), which includes ${J(105)} (pull request #298) and ${J(106)} (#296).`,
        `The prod environment runs 1.13.2 (1a2b3c4), merged before the sprint, so none of Sprint 42's work is in prod yet.`,
        `${J(101)} and ${J(104)} have pull requests still open, so neither is deployed anywhere.`,
      ],
    },
  },
  settlement: {
    risk: {
      label: "What's at risk in this dossier?",
      parts: [
        `It is day 7 of 9 of Sprint 42: 1 of 16 points is done and 15 remain. The points leave out ${A(2305)}, which is estimated in hours.`,
        `${A(2303)} can't start until ${A(2302)} is done, and 2302's pull request #87 is still building.`,
        `${A(2304)} came over from Sprint 41 with nothing linked to it. ${A(2305)} and ${A(2306)} were added after the sprint started.`,
        `${A(2307)} was removed from the backlog, which OWI 0.1 counts as done.`,
      ],
    },
    deployed: {
      label: 'Where is this work deployed?',
      parts: [
        `The test environment runs settlement-deploy 20261008.1 (c84e5f0), which includes ${A(2305)} through pull request #84.`,
        `The prod environment runs 20261002.1 (b80a1d2), the job skeleton from before the sprint, so none of Sprint 42's work is in prod yet.`,
        `${A(2302)}'s pull request #87 is open and its CI run is still in progress.`,
      ],
    },
  },
  'checkout-web': {
    risk: {
      label: "What's at risk in this dossier?",
      parts: [
        `It is day 7 of 10 of Sprint 42: 1 of 11 points is done and 10 remain.`,
        `${G(43)} was added after the sprint started, and its draft pull request #53 fails the e2e-safari check.`,
        `${G(45)} was added on day one and has no estimate.`,
      ],
    },
    deployed: {
      label: 'Where is this work deployed?',
      parts: [
        `The staging environment runs payments-web 2026.10.12 (5a7e3f1), which includes ${G(44)}'s fix, pull request #50.`,
        `The prod environment runs 2026.10.02 (1c9b8e4), so ${G(44)} isn't in prod yet.`,
        `${G(42)} and ${G(43)} have pull requests still open, so neither is deployed anywhere.`,
      ],
    },
  },
};

const UNSCRIPTED = 'This preview answers only its starter questions. The released app sends your question to the agent your organization approved.';

export function scriptedAgent(): Agent {
  return {
    starters: (dossier: string): Starter[] => Object.entries(SCRIPTS[dossier] ?? {}).map(([id, s]) => ({ id, label: s.label })),
    async ask(dossier: string, prompt: string): Promise<Answer> {
      const script = SCRIPTS[dossier] ?? {};
      const entry = script[prompt] ?? Object.values(script).find((s) => s.label === prompt);
      const parts: AnswerPart[] = (entry?.parts ?? [UNSCRIPTED]).map((text) => ({ text }));
      return { prompt: entry?.label ?? prompt, parts, citations: citationsOf(parts), by: 'scripted' };
    },
  };
}

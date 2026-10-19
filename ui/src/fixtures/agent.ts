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
import type { Proposal } from '../proposal.ts';

const J = (n: number) => `[[corp-jira:PAY-${n}]]`;
const A = (n: number) => `[[corp-ado:${n}]]`;
const G = (n: number) => `[[github:imagile/payments-web#${n}]]`;

export interface Script {
  label: string;
  parts: string[];
  /** Changes the answer suggests; the pane shows them as cards to review, never applies them. */
  proposals?: Proposal[];
}

const agentProposal = (p: Omit<Proposal, 'id' | 'from'>): Proposal => ({ id: `agent:${p.item}:${p.command ?? 'none'}`, from: 'agent', ...p });

export const SCRIPTS: Record<string, Record<string, Script>> = {
  'card-payments': {
    risk: {
      label: "What's at risk in this dossier?",
      parts: [
        `It is day 7 of 10 of Sprint 42: 3 of 21 points are done and 18 remain.`,
        `${J(101)}'s pull request #311 fails its Jenkins build, and ${J(102)} and ${J(103)} are blocked behind it, holding 11 points back.`,
        `${J(104)} came over from Sprint 41 and its pull request #305 is still open. ${J(107)} was added after the sprint started, with no estimate.`,
      ],
      proposals: [
        agentProposal({
          item: 'corp-jira:PAY-107',
          title: 'Estimate PAY-107 at 3 points',
          reason: `${J(107)} was added mid-sprint with no estimate, so the sprint's points leave it out. It is a retry of one call, about the size of ${J(105)}.`,
          command: 'jira update-issue',
          input: { dossier: 'card-payments', key: 'PAY-107', field: ['Story Points=3'] },
          note: 'A suggested size. Agree it with the team before applying.',
        }),
      ],
    },
    attention: {
      label: 'What needs attention first?',
      parts: [
        `${J(102)} is blocked by ${J(101)} and holds up ${J(103)}, and nothing has changed on it for 8 days.`,
        `${J(104)} has been in progress for 13.9 days, longer than 85% of this dossier's finished items took (11 days). It came over from Sprint 41 and hasn't been updated for 5.9 days.`,
        `${J(101)}'s latest build failed, and it blocks ${J(102)}: fixing that build unblocks the chain.`,
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
      proposals: [
        agentProposal({
          item: 'corp-ado:2303',
          title: 'Move 2303 to Sprint 43',
          reason: `${A(2303)} can't start until ${A(2302)} is done, with two working days left in the sprint.`,
          command: 'ado work update',
          input: { dossier: 'settlement', id: 2303, field: ['System.IterationPath=Payments\\Sprint 43'] },
          note: null,
        }),
      ],
    },
    attention: {
      label: 'What needs attention first?',
      parts: [
        `${A(2304)} has been in progress for 15 days, longer than 85% of this dossier's finished items took (8.3 days). It came over from Sprint 41 and hasn't been updated for 5.9 days.`,
        `${A(2303)} is blocked by ${A(2302)}, and nothing has changed on it for 7.9 days.`,
        `${A(2302)} blocks ${A(2303)} and hasn't been updated for 7 days.`,
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
      proposals: [
        agentProposal({
          item: 'github:imagile/payments-web#45',
          title: 'Estimate payments-web#45',
          reason: `${G(45)} has no Estimate on project 7, so the sprint's points leave it out.`,
          command: null,
          input: null,
          note: "toil has no command that sets a GitHub Projects field yet. Set Estimate on the project board: https://ghe.imagile.dev/imagile/payments-web/issues/45.",
        }),
      ],
    },
    attention: {
      label: 'What needs attention first?',
      parts: [
        `${G(43)}'s latest build failed on e2e-safari, it was added after the sprint started, and nothing has changed on it for 6 days.`,
        `${G(45)} has no estimate and hasn't been updated for 7.9 days.`,
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

export interface ScriptedOptions {
  /** Milliseconds between streamed words; 0 streams as fast as the page renders. */
  delay?: number;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** Splits text into words, never inside a `[[citation]]`, so a half-streamed answer never shows a broken link. */
const words = (text: string) => text.match(/\[\[[^\]]+\]\]\S*\s*|\S+\s*/g) ?? [];

export function scriptedAgent({ delay = 0 }: ScriptedOptions = {}): Agent {
  const answer = (dossier: string, prompt: string): Answer => {
    const script = SCRIPTS[dossier] ?? {};
    const entry = script[prompt] ?? Object.values(script).find((s) => s.label === prompt);
    const parts: AnswerPart[] = (entry?.parts ?? [UNSCRIPTED]).map((text) => ({ text }));
    return { prompt: entry?.label ?? prompt, parts, citations: citationsOf(parts), by: 'scripted', proposals: entry?.proposals ?? [] };
  };
  return {
    starters: (dossier: string): Starter[] => Object.entries(SCRIPTS[dossier] ?? {}).map(([id, s]) => ({ id, label: s.label })),
    ask: async (dossier, prompt) => answer(dossier, prompt),
    async *stream(dossier, prompt, signal) {
      const whole = answer(dossier, prompt);
      const parts: AnswerPart[] = [];
      for (const part of whole.parts) {
        let text = '';
        parts.push({ text });
        for (const w of words(part.text)) {
          if (signal?.aborted) return;
          text += w;
          parts[parts.length - 1] = { text };
          yield { ...whole, parts: [...parts], citations: citationsOf(parts), proposals: [] };
          await wait(delay, signal);
        }
      }
      yield whole;
    },
  };
}

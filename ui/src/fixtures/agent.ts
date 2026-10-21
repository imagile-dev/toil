/**
 * The scripted Agent: canned answers about each dossier, citing the work
 * items they rest on, with the pull requests, builds and deployments named by
 * the ids the commands returned. Nothing here calls a model. test/agent.test.ts
 * recomputes every figure and citation from what the dashboard loads through
 * the fixture `execute()`, so the script can't drift from the data. The
 * answers were approved in advance, which is more than most status reports can
 * say.
 */

import type { AdapterList, Agent, Answer, AnswerPart, AskStyle, Starter } from '../agent.ts';
import { ANALYZE, SCRIPTED_LABEL, citationsOf } from '../agent.ts';
import type { ChatTurn } from '../model-usage.ts';
import type { Proposal } from '../proposal.ts';
import { sampleAnswerUsage } from './model-usage.ts';

const J = (n: number) => `[[corp-jira:PAY-${n}]]`;
const A = (n: number) => `[[corp-ado:${n}]]`;
const G = (n: number) => `[[github:imagile/payments-web#${n}]]`;
/** A pull request, by its OWI change id. */
const P = (id: string) => `[[${id}]]`;
const BB = (n: number) => P(`corp-bitbucket:PAY/payments-core#${n}`);
const AZ = (n: number) => P(`corp-ado:Payments/settlement#${n}`);
const GH = (n: number) => P(`github:imagile/payments-web#${n}`);
const SDK = (n: number) => P(`bitbucket-cloud:imagile/checkout-sdk#${n}`);

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
          command: 'jira issue update',
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
    people: {
      label: "Who's overloaded or blocked?",
      parts: [
        `Nobody is over the dossier's limit of 2 items in progress. J. Smith has ${J(101)} in progress for 6.9 days, and A. Chen has ${J(104)} in review for 5.9 days.`,
        `A. Chen is blocked: ${J(102)} waits on ${J(101)}, still in progress with J. Smith, whose pull request ${BB(311)} now waits on J. Smith after A. Chen asked for changes.`,
        `One review waits on J. Smith: ${BB(305)}, open 3.9 working days. A. Chen's Bitbucket account isn't mapped to her yet; the People view suggests it.`,
      ],
    },
    review: {
      label: "What's stuck in review, and why?",
      parts: [
        `${BB(305)} has waited 3.9 working days for a first review from J. Smith, and it now has a merge conflict. It carries ${J(104)}, which came over from Sprint 41.`,
        `${BB(311)} waits on its author: A. Chen asked for changes 0.6 working days ago, and its Jenkins build fails. It carries ${J(101)}, which blocks ${J(102)}.`,
        `A first review here usually comes within 0.3 working days (the median of 4 pull requests), so 305 is well past it.`,
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
        `${A(2307)} was removed from the backlog, which OWI counts as done.`,
      ],
      proposals: [
        agentProposal({
          item: 'corp-ado:2303',
          title: 'Move 2303 to Sprint 43',
          reason: `${A(2303)} can't start until ${A(2302)} is done, with two working days left in the sprint.`,
          command: 'ado work-item update',
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
    people: {
      label: "Who's overloaded or blocked?",
      parts: [
        `This dossier sets no limit and lists nobody yet, so each account stands on its own. D. Okafor has ${A(2302)} in progress for 7 days, and M. Lind has ${A(2304)} for 15 days.`,
        `D. Okafor's pull request ${AZ(87)} waits on D. Okafor: J. Park asked for changes 0.8 working days ago.`,
        `Nobody's own items are blocked. ${A(2303)} is blocked by ${A(2302)}, but nobody is assigned to it.`,
      ],
    },
    review: {
      label: "What's stuck in review, and why?",
      parts: [
        `${AZ(87)} waits on its author: J. Park voted -5 (waiting for the author) 0.8 working days ago, and its CI run is still going. It carries ${A(2302)}, which ${A(2303)} waits on.`,
        `Nothing else is open. A first review here has taken 0.8 working days at the median, over 3 pull requests.`,
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
        `${G(42)}'s pull request is merged, but no environment runs it yet.`,
      ],
    },
    deployed: {
      label: 'Where is this work deployed?',
      parts: [
        `The staging environment runs payments-web 2026.10.12 (5a7e3f1), which includes ${G(44)}'s fix, pull request #50.`,
        `The prod environment runs 2026.10.02 (1c9b8e4), so ${G(44)} isn't in prod yet.`,
        `${G(42)} and ${G(43)} have pull requests still open, so neither is deployed anywhere. ${G(44)}'s SDK change, imagile/checkout-sdk #12, is still open too.`,
      ],
    },
    people: {
      label: "Who's overloaded or blocked?",
      parts: [
        `Nobody is over the dossier's limit of 2. Bo W. has ${G(42)} in review; GitHub records no move into that status, so how long it has sat there is unknown.`,
        `Two reviews wait on Ada D.: ${SDK(12)} and ${GH(52)}, each open 1.3 working days.`,
        `${GH(51)}, which Ada D. wrote with Claude, waits on its failing checks, for 2 working days. Nothing assigned to anyone is blocked.`,
      ],
    },
    review: {
      label: "What's stuck in review, and why?",
      parts: [
        `${GH(51)} has its failing test check to fix first, failing for 2 working days. It has been open 3 working days with no reviewer asked and names no work item. An agent wrote it: its commit carries a Co-Authored-By: Claude trailer.`,
        `${SDK(12)} waits 1.3 working days for review from Ada D., but ${G(44)}, the issue it is for, is already closed. An agent wrote it too (a copilot/ branch).`,
        `${GH(52)} waits 1.3 working days for review from ada-dev. It carries ${G(42)}.`,
        `${GH(53)} is a draft, failing e2e-safari, for ${G(43)}.`,
      ],
    },
  },
};

/**
 * The risk answers again, in each game theme's voice (#283), for when
 * "Themed agent voice" is on: the same citations, figures and proposals, in
 * other words. test/agent.test.ts holds each to its standard answer, which is
 * what a voice may change and what it may not.
 */
export const VOICED: Record<string, Record<string, string[]>> = {
  'card-payments': {
    crate: [
      `Day 7 of 10 on Sprint 42. 3 of 21 points are on the truck, 18 still on the floor.`,
      `${J(101)} is the pallet in the aisle: its pull request #311 fails the Jenkins build, and ${J(102)} and ${J(103)} wait behind it. That is 11 points not moving.`,
      `${J(104)} came over from Sprint 41, and its pull request #305 is still open at the dock. ${J(107)} turned up after the sprint started, with no estimate on the label.`,
    ],
    harvest: [
      `We're on day 7 of 10 of Sprint 42. 3 of 21 points are in the barn, and 18 are still in the ground.`,
      `${J(101)}'s pull request #311 keeps failing its Jenkins build, and ${J(102)} and ${J(103)} can't grow until it's mended. That's 11 points waiting on one fence.`,
      `${J(104)} was carried over from Sprint 41, and its pull request #305 is still open. ${J(107)} was planted after the sprint started, with no estimate yet.`,
    ],
    starship: [
      `Ship's log, day 7 of 10 of Sprint 42. 3 of 21 points complete; 18 remain.`,
      `Fault: ${J(101)}'s pull request #311 fails its Jenkins build. ${J(102)} and ${J(103)} are held behind it, 11 points in all.`,
      `${J(104)} transferred from Sprint 41 with pull request #305 still open. ${J(107)} came aboard after the sprint started, with no estimate logged.`,
    ],
    realm: [
      `Day 7 of 10 of Sprint 42. 3 of 21 points are taken; 18 are not.`,
      `${J(101)}'s pull request #311 fails its Jenkins build. The road is broken there, and ${J(102)} and ${J(103)} wait behind it: 11 points held.`,
      `${J(104)} was carried from Sprint 41, its pull request #305 still open. ${J(107)} entered the ledger after the sprint began, with no estimate.`,
    ],
  },
  settlement: {
    crate: [
      `Day 7 of 9 on Sprint 42. 1 of 16 points is shipped, 15 still on the floor. ${A(2305)} isn't in that count: it's weighed in hours, not points.`,
      `${A(2303)} can't move until ${A(2302)} clears, and 2302's pull request #87 is still on the forklift check.`,
      `${A(2304)} came over from Sprint 41 with nothing strapped to it. ${A(2305)} and ${A(2306)} arrived after the sprint started.`,
      `${A(2307)} was taken off the backlog, which OWI books as done.`,
    ],
    harvest: [
      `Day 7 of 9 of Sprint 42: 1 of 16 points is harvested and 15 are still growing. ${A(2305)} isn't counted in those points; it's measured in hours.`,
      `${A(2303)} can't be planted until ${A(2302)} is done, and 2302's pull request #87 is still building.`,
      `${A(2304)} came over from Sprint 41 with nothing linked to it. ${A(2305)} and ${A(2306)} were sown after the sprint started.`,
      `${A(2307)} was cleared from the backlog, which OWI counts as done.`,
    ],
    starship: [
      `Ship's log, day 7 of 9 of Sprint 42. 1 of 16 points complete; 15 remain. ${A(2305)} is excluded from the count: it is estimated in hours.`,
      `${A(2303)} cannot launch until ${A(2302)} is done. 2302's pull request #87 is still building.`,
      `${A(2304)} transferred from Sprint 41 with no links. ${A(2305)} and ${A(2306)} came aboard after the sprint started.`,
      `${A(2307)} was removed from the backlog, which OWI logs as done.`,
    ],
    realm: [
      `Day 7 of 9 of Sprint 42. 1 of 16 points is taken; 15 remain. ${A(2305)} is not reckoned in points: it is measured in hours.`,
      `${A(2303)} cannot march until ${A(2302)} is done, and 2302's pull request #87 is still building.`,
      `${A(2304)} was carried from Sprint 41, bound to nothing. ${A(2305)} and ${A(2306)} entered after the sprint began.`,
      `${A(2307)} was struck from the backlog, which OWI counts as done.`,
    ],
  },
  'checkout-web': {
    crate: [
      `Day 7 of 10 on Sprint 42. 1 of 11 points is shipped, 10 still on the floor.`,
      `${G(43)} turned up after the sprint started, and its draft pull request #53 fails the e2e-safari check.`,
      `${G(45)} has been on the floor since day one with no estimate on the label.`,
    ],
    harvest: [
      `Day 7 of 10 of Sprint 42: 1 of 11 points is harvested and 10 are still growing.`,
      `${G(43)} was sown after the sprint started, and its draft pull request #53 fails the e2e-safari check.`,
      `${G(45)} was planted on day one and still has no estimate.`,
    ],
    starship: [
      `Ship's log, day 7 of 10 of Sprint 42. 1 of 11 points complete; 10 remain.`,
      `${G(43)} came aboard after the sprint started; its draft pull request #53 fails the e2e-safari check.`,
      `${G(45)} has been aboard since day one with no estimate logged.`,
    ],
    realm: [
      `Day 7 of 10 of Sprint 42. 1 of 11 points is taken; 10 remain.`,
      `${G(43)} entered after the sprint began, and its draft pull request #53 fails the e2e-safari check.`,
      `${G(45)} was taken up on day one. It still has no estimate.`,
    ],
  },
};

/**
 * What the sample's switcher lists (#344): the scripted agent, ready, and the
 * three adapters, each unavailable because the sample never runs a model.
 */
export const SAMPLE_ADAPTERS: AdapterList = {
  chosen: 'scripted',
  options: [
    { name: 'scripted', label: SCRIPTED_LABEL, model: null, ready: true, problem: null, fix: null, action: null },
    ...(['Claude', 'GitHub Copilot', 'Codex'] as const).map((label) => ({
      name: label === 'Claude' ? 'claude' : label === 'Codex' ? 'codex' : 'copilot',
      label,
      model: null,
      ready: false,
      problem: `The sample answers with ${SCRIPTED_LABEL}, so ${label} isn't offered here.`,
      fix: 'Start toil-ui without --sample to switch between the agents installed on this machine.',
      action: null,
    })),
  ],
};

const UNSCRIPTED = 'This preview answers only its starter questions. Installed, Toil UI sends your question to the agent you pick.';

/** The stand-up's "Write it up" (#345), scripted: where a real agent's narrative goes, naming two fact lines as one would. */
const STANDUP_WRITE_UP = /^write up the stand-up for /i;
const SCRIPTED_WRITE_UP = [
  "This is the preview's scripted write-up, not a model's: it shows where the agent's short narrative of the report goes. The team lines come first (F1).",
  "Then each person's done, in progress, blocked and next, in the report's order, each sentence naming the fact lines it rests on (F2).",
];

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

/** Analyze in the preview (#343): the scripted answers it covers, in its order, so every line is one the tests already hold to the data. */
export const ANALYZE_PARTS = ['risk', 'attention', 'people', 'review'] as const;

export function scriptedAgent({ delay = 0 }: ScriptedOptions = {}): Agent {
  const answer = (dossier: string, prompt: string, style?: AskStyle, chat?: ChatTurn): Answer => {
    const script = SCRIPTS[dossier] ?? {};
    if (prompt === ANALYZE && SCRIPTS[dossier]) {
      const parts: AnswerPart[] = ANALYZE_PARTS.flatMap((id) => script[id]?.parts ?? []).map((text) => ({ text }));
      return { prompt: 'Analyze', parts, citations: citationsOf(parts), by: 'scripted', adapter: 'scripted', model: null, proposals: script.risk?.proposals ?? [], ...(chat ? { usage: sampleAnswerUsage(chat.id, chat.turn, dossier) } : {}) };
    }
    const id = script[prompt] ? prompt : Object.entries(script).find(([, s]) => s.label === prompt)?.[0];
    const entry = id ? script[id] : undefined;
    // The voiced risk answer when the voice is on and the theme has one; Plain, and the voice off, read the standard.
    const voiced = id === 'risk' && style?.voice ? VOICED[dossier]?.[style.theme] : undefined;
    const parts: AnswerPart[] = (voiced ?? entry?.parts ?? (STANDUP_WRITE_UP.test(prompt) ? SCRIPTED_WRITE_UP : [UNSCRIPTED])).map((text) => ({ text }));
    // In a chat, the answer carries sample usage figures (#295), marked as made up, so the footer has something to show.
    return { prompt: entry?.label ?? prompt, parts, citations: citationsOf(parts), by: 'scripted', adapter: 'scripted', model: null, proposals: entry?.proposals ?? [], ...(chat ? { usage: sampleAnswerUsage(chat.id, chat.turn, dossier) } : {}) };
  };
  return {
    label: SCRIPTED_LABEL,
    adapters: async () => SAMPLE_ADAPTERS,
    starters: (dossier: string): Starter[] => Object.entries(SCRIPTS[dossier] ?? {}).map(([id, s]) => ({ id, label: s.label })),
    ask: async (dossier, prompt, style, chat) => answer(dossier, prompt, style, chat),
    async *stream(dossier, prompt, signal, style, chat) {
      const { usage, ...whole } = answer(dossier, prompt, style, chat);
      const parts: AnswerPart[] = [];
      for (const part of whole.parts) {
        let text = '';
        parts.push({ text });
        for (const w of words(part.text)) {
          if (signal?.aborted) return;
          text += w;
          parts[parts.length - 1] = { text };
          // The status line says Writing, and only that: the script reads no tools, so it never claims to.
          yield { ...whole, parts: [...parts], citations: citationsOf(parts), proposals: [], activity: { phase: 'writing' } };
          await wait(delay, signal);
        }
      }
      yield usage ? { ...whole, usage } : whole;
    },
  };
}

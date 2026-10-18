/**
 * Progression for Two Weeks' Notice. Every run accrues paid time off, which
 * can never be taken, only spent: on perks bought at Benefits Enrollment
 * between runs. Perks persist from run to run (src/welcome/rogue/save.ts keeps
 * them in the user's config, encrypted), and a rank goes up with every notice
 * delivered. The pay does not.
 */

export type PerkId = 'chair' | 'monitor' | 'coffee' | 'template' | 'licence' | 'context' | 'hours' | 'headphones' | 'badge';

export interface Perk {
  id: PerkId;
  name: string;
  /** What it does, plainly. */
  effect: string;
  /** What the enrollment form says about it. */
  blurb: string;
  /** PTO hours for each level, in order; its length is the number of levels. */
  costs: number[];
  /** Shown, but not for sale, until this is true of the save. */
  unlock?: { best: number; text: string };
}

export const PERKS: Perk[] = [
  { id: 'chair', name: 'Ergonomic chair', effect: '+5 maximum morale a level', blurb: 'Approved after an eighteen-month review. It leans slightly left, like the review.', costs: [20, 45, 80] },
  { id: 'template', name: 'Strongly worded email template', effect: '+1 grit a level', blurb: '"Per my last email," pre-filled. Legal has asked to be removed from the distribution list.', costs: [25, 55, 95] },
  { id: 'coffee', name: 'Coffee subscription', effect: 'Coffee restores 3 more a level', blurb: 'Bean-to-cup. The beans come from a vendor who also does enterprise architecture.', costs: [15, 40] },
  { id: 'monitor', name: 'Second monitor', effect: 'See 1 cell further a level', blurb: 'Requisitioned in 2022. It arrived this morning, still in a box marked "URGENT".', costs: [30, 70] },
  { id: 'licence', name: 'AI agent licence', effect: 'Start each run with an AI agent', blurb: 'Procurement approved one seat after only four committees. The seat is yours, the agent is anyone\'s.', costs: [60] },
  { id: 'context', name: 'Larger context window', effect: 'Agents stay 20 turns longer a level', blurb: 'Your agents now remember almost an entire meeting, which is more than anyone in it.', costs: [35, 75] },
  { id: 'headphones', name: 'Noise-cancelling headphones', effect: 'Briefings and forms catch you half as often', blurb: 'They cancel every frequency except your name, said by a vice president.', costs: [50] },
  { id: 'hours', name: 'Maverick\'s office hours', effect: 'Maverick can drop in twice a floor', blurb: 'Booked through a form that Maverick filled out for you, with diagrams.', costs: [70], unlock: { best: 2, text: 'Reach Floor 2 to unlock.' } },
  { id: 'badge', name: 'Badge upgrade', effect: 'Start each run on Floor 1', blurb: 'Your badge now opens the stairwell door to Floor 1. The elevator remains aspirational.', costs: [90], unlock: { best: 3, text: 'Reach Floor 3 to unlock.' } },
];

/** What persists between runs. Saved encrypted; never trusted until it decrypts. */
export interface Progress {
  /** Accrued, unspent PTO hours. */
  pto: number;
  /** The level bought of each perk. */
  perks: Partial<Record<PerkId, number>>;
  runs: number;
  /** Notices actually delivered. */
  wins: number;
  /** The highest floor reached, from 0. */
  best: number;
  /** The best score of any run. */
  high: number;
  /** Set once the intro has been read, so later runs skip it. */
  briefed: boolean;
}

export const freshProgress = (): Progress => ({ pto: 0, perks: {}, runs: 0, wins: 0, best: 0, high: 0, briefed: false });

export const level = (p: Progress, id: PerkId): number => p.perks[id] ?? 0;

export const perk = (id: PerkId): Perk => PERKS.find((x) => x.id === id)!;

/** The next level's price, or undefined when it's bought out. */
export const price = (p: Progress, id: PerkId): number | undefined => perk(id).costs[level(p, id)];

export const unlocked = (p: Progress, id: PerkId): boolean => !perk(id).unlock || p.best >= perk(id).unlock!.best;

export type Refusal = 'maxed' | 'locked' | 'poor';

/** Buys the next level of a perk, or says why not. */
export function buy(p: Progress, id: PerkId): Progress | Refusal {
  const cost = price(p, id);
  if (cost === undefined) return 'maxed';
  if (!unlocked(p, id)) return 'locked';
  if (p.pto < cost) return 'poor';
  return { ...p, pto: p.pto - cost, perks: { ...p.perks, [id]: level(p, id) + 1 } };
}

/** Ranks by notices delivered. Every promotion comes with no change in pay. */
export const RANKS = ['Developer I', 'Developer II', 'Senior Developer', 'Staff Developer', 'Principal Developer', 'Distinguished Former Employee'];
export const rankOf = (p: Progress): string => RANKS[Math.min(RANKS.length - 1, p.wins)]!;

/** What a run earns: hours for every floor climbed and everyone dealt with, and a lump sum for actually leaving. */
export function accrued(run: { floor: number; defeated: number; won: boolean }): number {
  return run.floor * 8 + run.defeated * 2 + (run.won ? 40 : 0);
}

/** Folds a finished run into the save. */
export function settle(p: Progress, run: { floor: number; defeated: number; won: boolean; score: number }): Progress {
  return {
    ...p,
    pto: p.pto + accrued(run),
    runs: p.runs + 1,
    wins: p.wins + (run.won ? 1 : 0),
    best: Math.max(p.best, run.floor),
    high: Math.max(p.high, run.score),
  };
}

/** Everything a run needs to know about the perks, as numbers. */
export interface Loadout {
  morale: number;
  grit: number;
  coffee: number;
  sight: number;
  agent: boolean;
  context: number;
  /** Chance a briefing or form lands, from 0 to 1. */
  nag: number;
  maverick: number;
  floor: number;
}

export function loadout(p: Progress): Loadout {
  return {
    morale: 30 + 5 * level(p, 'chair'),
    grit: 3 + level(p, 'template'),
    coffee: 8 + 3 * level(p, 'coffee'),
    sight: 7 + level(p, 'monitor'),
    agent: level(p, 'licence') > 0,
    context: 45 + 20 * level(p, 'context'),
    nag: level(p, 'headphones') > 0 ? 0.5 : 1,
    maverick: level(p, 'hours') > 0 ? 2 : 1,
    floor: level(p, 'badge') > 0 ? 1 : 0,
  };
}

/** A save as read from disk: only what has the right shape survives; anything else is a fresh start. */
export function parseProgress(raw: unknown): Progress | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
  const perks: Progress['perks'] = {};
  if (r.perks && typeof r.perks === 'object') {
    for (const p of PERKS) {
      const lv = n((r.perks as Record<string, unknown>)[p.id]);
      if (lv !== undefined) perks[p.id] = Math.min(lv, p.costs.length);
    }
  }
  const fields = { pto: n(r.pto), runs: n(r.runs), wins: n(r.wins), best: n(r.best), high: n(r.high) };
  if (Object.values(fields).some((v) => v === undefined)) return undefined;
  return { ...(fields as Omit<Progress, 'perks' | 'briefed'>), perks, briefed: r.briefed === true };
}

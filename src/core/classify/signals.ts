/**
 * Toil's built-in keep-the-lights-on signals: what almost every team already
 * means by "KTLO" before anyone writes a rule. They rank below the team's own
 * rules, because tracker types are noisy, and each names itself in the verdict
 * so a person can see which one fired and overrule it. Reading a security
 * advisory number out of a ticket is, at most organisations, the only
 * security process that has ever completed on schedule.
 */
import type { WorkItem } from '../owi/types.js';

export const SIGNAL_NAMES = ['type', 'security-id', 'incident-link', 'bot-author', 'label', 'title'] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

export interface SignalHit {
  name: SignalName;
  reason: string;
}

/** How much of a body is scanned for an advisory id: a ticket that long is not about one CVE. */
export const BODY_SCAN_LIMIT = 20_000;

const CVE = /\bCVE-\d{4}-\d{4,}\b/i;
// GitHub advisory ids use a 20-letter alphabet with no vowels, digits 0 and 1 or l, o, u.
const GHSA = /\bGHSA(?:-[23456789cfghjmpqrvwx]{4}){3}\b/i;
const BOT = /dependabot|renovate/i;
const LABELS = new Set(['security', 'dependencies', 'compliance', 'incident', 'hotfix']);
const TITLE = /^\s*(?:bump|upgrade|patch)\b/i;

function bodyText(item: WorkItem): string {
  const content = item.body?.content;
  if (content === undefined) return '';
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return text.slice(0, BODY_SCAN_LIMIT);
}

/** The first signal that applies to `item`, in the order the verdict ranks them; null when none does. */
export function detectSignal(item: WorkItem, byId: ReadonlyMap<string, WorkItem>): SignalHit | null {
  if (item.type === 'BUG' || item.type === 'INCIDENT') {
    return { name: 'type', reason: `Its type is ${item.typeName ?? (item.type === 'BUG' ? 'Bug' : 'Incident')}.` };
  }

  const id = CVE.exec(item.title) ?? GHSA.exec(item.title) ?? CVE.exec(bodyText(item)) ?? GHSA.exec(bodyText(item));
  if (id) return { name: 'security-id', reason: `It names the security advisory ${id[0].toUpperCase()}.` };

  for (const link of item.links) {
    const target = byId.get(link.target);
    if (target?.type === 'INCIDENT') return { name: 'incident-link', reason: `It links to the incident ${target.source.key}.` };
  }

  // A pull request's author kind says who wrote the change, not who opened the item, so only the reporter counts here.
  const reporter = item.reporter?.name ?? item.reporter?.id ?? '';
  if (BOT.test(reporter) || BOT.test(item.reporter?.id ?? '')) return { name: 'bot-author', reason: `It was opened by a dependency bot (${reporter}).` };

  const label = item.labels.find((l) => LABELS.has(l.toLowerCase()));
  if (label !== undefined) return { name: 'label', reason: `It carries the label "${label}".` };

  const opener = TITLE.exec(item.title);
  if (opener) return { name: 'title', reason: `Its title opens with "${opener[0].trim()}".` };
  return null;
}

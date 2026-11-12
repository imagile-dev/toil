import { at, jiraTime } from './kit.js';
import { byKey } from './people.js';
import type { Placed } from './jira.js';

/**
 * The comments the sample team's Jira issues carry, written by hand so the
 * stand-up has something to remind people of: questions nobody has answered,
 * one that was, a person who comments a lot, a comment from the AI agent, and
 * most of the team who said nothing at all. Each is placed by the title of the
 * item it is on and by a working day from today, so the sample stays current
 * and a reworded title fails loudly instead of quietly moving a question.
 * There is no randomness here: a conversation is not a place for dice.
 * Nobody on this team has ever answered a question in under a day, which is
 * accurate and also the reason these exist.
 */

interface Said {
  /** The title of the item it is on. */
  on: string;
  by: string;
  /** Working day, 0 is today (whose moments stop at 07:59). */
  day: number;
  hour: number;
  minute: number;
  text: string;
}

const SAID: Said[] = [
  // Older talk, answered or settled, so the totals are not only this week's.
  { on: 'Replace the nightly export script', by: 'sg', day: -6, hour: 10, minute: 5, text: 'Which team still reads the CSV from the old export?' },
  { on: 'Replace the nightly export script', by: 'do', day: -6, hour: 13, minute: 40, text: 'Only finance, and they are moving to the API in Sprint 27.' },
  // An open question from last Friday: no reply in four days.
  { on: 'Upgrade the Postgres cluster to 16', by: 'sg', day: -3, hour: 10, minute: 15, text: 'Dry run on staging finished in 38 minutes, no errors.' },
  { on: 'Upgrade the Postgres cluster to 16', by: 'do', day: -2, hour: 16, minute: 40, text: 'Do we have a rollback plan if the 16 upgrade slips past the maintenance window?' },
  // Yesterday's question: still waiting.
  { on: 'Facet counts are stale after a bulk price update', by: 'ac', day: -1, hour: 11, minute: 20, text: 'Do we need a migration for the facet counts, or will the reindex job cover it?' },
  // A question that was answered: it must not show as outstanding.
  { on: 'Checkout fails for postcodes with a trailing space', by: 'rp', day: -1, hour: 10, minute: 15, text: 'Is the trailing space also stripped on the billing postcode?' },
  { on: 'Checkout fails for postcodes with a trailing space', by: 'js', day: -1, hour: 14, minute: 30, text: 'Yes, both go through the same validator. Covered by the new test.' },
  // A person who comments a lot (past the stand-up's fold of three).
  { on: 'Order cancellation before dispatch', by: 'kn', day: -1, hour: 9, minute: 30, text: 'Rebased onto main, CI is green again.' },
  { on: 'Loyalty tiers and tier badges', by: 'kn', day: -1, hour: 11, minute: 45, text: 'Badge artwork is in the shared drive, thanks for the quick turnaround.' },
  { on: 'Refunds issued to the original payment method', by: 'kn', day: -1, hour: 13, minute: 10, text: 'Added the partial-refund case to the test plan.' },
  { on: 'Move image storage behind the CDN', by: 'kn', day: -1, hour: 15, minute: 25, text: 'The cache headers look right from the storefront side.' },
  { on: 'Patch CVE-2026-35002 in the HTTP client', by: 'kn', day: 0, hour: 7, minute: 5, text: 'Storefront builds pass with the patched client.' },
  // The AI agent's comment.
  { on: 'Patch CVE-2026-35002 in the HTTP client', by: 'ag', day: -1, hour: 17, minute: 10, text: 'Opened a pull request with the client bump and a regression test. It waits on a review.' },
  // This morning.
  { on: 'Rotate the TLS certificates before they expire', by: 'tn', day: 0, hour: 7, minute: 10, text: 'Renewed certificates are staged; I will cut over after stand-up.' },
];

const JIRA = 'https://jira.imagile.dev';
const jiraUser = (key: string) => {
  const p = byKey(key);
  return { self: `${JIRA}/rest/api/2/user?username=${p.jira}`, name: p.jira, key: p.jira, displayName: p.name, active: true };
};

/** Each item's `comment` field as Jira Data Center returns it in a search: an object for every issue, empty when nobody spoke. */
export function commentFields(base: number, placed: Placed[]): Map<string, Record<string, unknown>> {
  const by = new Map<string, Array<Record<string, unknown>>>();
  let id = 50000;
  for (const c of SAID) {
    const item = placed.find((p) => p.row.title === c.on);
    if (!item) throw new Error(`The sample backlog has no item called "${c.on}" for a comment to be on.`);
    const when = jiraTime(at(base, c.day, c.hour, c.minute));
    id++;
    const entry = { self: `${JIRA}/rest/api/2/issue/${10000 + item.num}/comment/${id}`, id: String(id), author: jiraUser(c.by), body: c.text, updateAuthor: jiraUser(c.by), created: when, updated: when };
    by.set(item.key, [...(by.get(item.key) ?? []), entry]);
  }
  return new Map(placed.map((p) => [p.key, { comments: by.get(p.key) ?? [], maxResults: (by.get(p.key) ?? []).length, total: (by.get(p.key) ?? []).length, startAt: 0 }]));
}

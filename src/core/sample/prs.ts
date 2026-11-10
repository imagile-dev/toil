import { at, between, rng } from './kit.js';
import { byKey, PEOPLE, RENOVATE } from './people.js';
import type { Placed } from './jira.js';

/**
 * The sample team's pull requests, as `toil github pr get --include
 * reviews,checks,commits,files` prints them: sixteen in the repository
 * imagile/shop. Seven are open and waiting, for an afternoon up to most of a
 * week, one of them behind a failing check for more than a day; nine are
 * merged, after reviews that took an hour or two days. Two come from a
 * dependency bot and one from an AI agent. Every title names the work item it
 * carries, because a pull request nobody can tie to a ticket is a finding
 * waiting for a quarter-end to be raised.
 */

export const GITHUB = 'https://github.imagile.dev';
export const GITHUB_API = `${GITHUB}/api/v3`;
export const OWNER = 'imagile';
export const REPO = 'shop';

type Reviewer = [person: string, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED', day: number, hour: number];
type Check = [name: string, conclusion: 'success' | 'failure' | null, day: number, hour: number];

interface Spec {
  /** The start of the title of the work item it carries. */
  item: string;
  /** What the pull request is called after the key, when not the item's own title. */
  name?: string;
  user: string;
  branch: string;
  created: [day: number, hour: number];
  merged?: [day: number, hour: number];
  draft?: boolean;
  requested?: string[];
  reviews?: Reviewer[];
  checks: Check[];
  files: Array<[path: string, additions: number, deletions: number]>;
  commits: string[];
  mergeable?: boolean;
}

const pass = (day: number, hour: number): Check[] => [['test', 'success', day, hour], ['e2e', 'success', day, hour]];

const SPECS: Spec[] = [
  { item: 'Delivery date picker', user: 'ac', branch: 'feature/delivery-date-picker', created: [-14, 10], merged: [-13, 11], reviews: [['ml', 'APPROVED', -13, 9]], checks: pass(-14, 11), commits: ['Add the delivery date picker', 'Disable dates the carrier cannot serve'], files: [['src/checkout/delivery-date.tsx', 164, 3], ['src/checkout/delivery-date.test.tsx', 72, 0]] },
  { item: 'Wishlist price-drop alerts', user: 'js', branch: 'feature/price-drop-alerts', created: [-13, 13], merged: [-11, 16], reviews: [['kn', 'CHANGES_REQUESTED', -12, 10], ['kn', 'APPROVED', -11, 15]], checks: pass(-13, 14), commits: ['Alert when a wishlist item drops in price', 'Throttle alerts to one a day'], files: [['src/accounts/price-alerts.ts', 118, 6], ['src/accounts/price-alerts.test.ts', 64, 0], ['src/email/templates/price-drop.html', 41, 0]] },
  { item: 'Upgrade the payment gateway client', user: 'do', branch: 'chore/gateway-client-v4', created: [-15, 9], merged: [-15, 15], reviews: [['sg', 'APPROVED', -15, 13]], checks: pass(-15, 10), commits: ['Upgrade the payment gateway client to v4'], files: [['package.json', 1, 1], ['src/payments/gateway.ts', 38, 41]] },
  { item: 'Patch CVE-2026-31337', user: 'tn', branch: 'security/image-resizer-patch', created: [-12, 9], merged: [-12, 11], reviews: [['do', 'APPROVED', -12, 10]], checks: pass(-12, 9), commits: ['Take the patched image resizer release'], files: [['package.json', 1, 1], ['package-lock.json', 14, 14]] },
  { item: 'Search within a category', user: 'rp', branch: 'feature/search-in-category', created: [-12, 15], merged: [-10, 13], reviews: [['ac', 'APPROVED', -10, 11]], checks: pass(-12, 16), commits: ['Scope the search box to the current category'], files: [['src/search/scope.ts', 52, 8], ['src/search/search-box.tsx', 21, 4]] },
  { item: 'Order notes for gift wrapping', user: 'kn', branch: 'feature/gift-wrap-notes', created: [-15, 11], merged: [-14, 16], reviews: [['js', 'APPROVED', -14, 15]], checks: pass(-15, 12), commits: ['Add a gift wrap note to the order'], files: [['src/checkout/gift-note.tsx', 58, 2]] },
  { item: 'Bump eslint and the typescript-eslint', name: 'Bump eslint from 9.12.0 to 9.14.0', user: 'renovate', branch: 'renovate/eslint-9.x', created: [-12, 6], merged: [-11, 10], reviews: [['tn', 'APPROVED', -11, 9]], checks: [['test', 'success', -12, 7]], commits: ['Bump eslint from 9.12.0 to 9.14.0'], files: [['package.json', 2, 2], ['package-lock.json', 31, 29]] },
  { item: 'Buy now, pay later', user: 'ac', branch: 'feature/bnpl-checkout', created: [-5, 9], merged: [-3, 15], reviews: [['rp', 'APPROVED', -3, 14]], checks: pass(-5, 10), commits: ['Add the pay-later option to the payment step', 'Show the instalment plan before confirming'], files: [['src/checkout/pay-later.tsx', 188, 9], ['src/checkout/pay-later.test.tsx', 97, 0], ['src/payments/plans.ts', 44, 0]] },
  { item: 'Loyalty points history', user: 'js', branch: 'feature/points-history', created: [-4, 10], merged: [-3, 11], reviews: [['ml', 'APPROVED', -3, 10]], checks: pass(-4, 11), commits: ['List loyalty points earned and spent'], files: [['src/accounts/points-history.tsx', 96, 0], ['src/accounts/points-history.test.tsx', 48, 0]] },
  { item: 'Size guide on product pages', user: 'ac', branch: 'feature/size-guide', created: [-1, 14], requested: ['ml'], checks: pass(-1, 15), commits: ['Add the size guide drawer'], files: [['src/catalog/size-guide.tsx', 132, 0], ['src/catalog/product-page.tsx', 9, 2]] },
  { item: 'Facet counts are stale', user: 'ml', branch: 'fix/facet-counts-after-price-update', created: [-3, 10], requested: ['ac', 'kn'], checks: pass(-3, 11), commits: ['Refresh facet counts after a bulk price update'], files: [['src/catalog/facets.ts', 27, 11]] },
  { item: 'Refunds issued to the original payment method', user: 'rp', branch: 'feature/refund-to-source', created: [-6, 11], reviews: [['kn', 'COMMENTED', -5, 10]], requested: ['kn'], checks: pass(-6, 12), commits: ['Refund to the payment method on the order', 'Fall back to store credit for expired cards'], files: [['src/orders/refunds.ts', 144, 22], ['src/orders/refunds.test.ts', 118, 0]], mergeable: false },
  { item: 'Order cancellation before dispatch', user: 'kn', branch: 'feature/cancel-before-dispatch', created: [-4, 15], draft: true, checks: pass(-4, 16), commits: ['Draft: cancel an order that has not shipped'], files: [['src/orders/cancel.ts', 73, 0]] },
  { item: 'Checkout fails for postcodes with a trailing space', user: 'js', branch: 'fix/postcode-trailing-space', created: [-4, 9], requested: ['ml'], checks: [['test', 'success', -4, 10], ['e2e', 'failure', -3, 10]], commits: ['Trim the postcode before validating it'], files: [['src/checkout/postcode.ts', 6, 2], ['src/checkout/postcode.test.ts', 14, 0]] },
  { item: 'Bump playwright', name: 'Bump playwright from 1.47.2 to 1.49.1', user: 'renovate', branch: 'renovate/playwright-1.x', created: [-1, 6], requested: ['tn'], checks: [['test', 'success', -1, 7]], commits: ['Bump playwright from 1.47.2 to 1.49.1'], files: [['package.json', 2, 2], ['package-lock.json', 26, 24]] },
  { item: 'Replace the nightly export script', user: 'ag', branch: 'copilot/replace-nightly-export', created: [-2, 13], requested: ['sg'], checks: pass(-2, 14), commits: ['Replace the nightly export script with a scheduled job'], files: [['jobs/nightly-export.ts', 87, 0], ['scripts/nightly-export.sh', 0, 52]] },
];

const sha = (seed: string): string => {
  const next = rng([...seed].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7));
  return Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(next() * 16)]).join('');
};

const user = (key: string) => {
  if (key === 'renovate') return { login: RENOVATE.github, id: 4100, avatar_url: `${GITHUB}/avatars/u/4100`, type: 'Bot' };
  const p = byKey(key);
  const id = 100 + PEOPLE.indexOf(p);
  return { login: p.github, id, avatar_url: `${GITHUB}/avatars/u/${id}`, type: p.kind === 'agent' ? 'Bot' : 'User' };
};

const repo = { id: 5200, name: REPO, full_name: `${OWNER}/${REPO}`, html_url: `${GITHUB}/${OWNER}/${REPO}`, owner: { login: OWNER, id: 1, type: 'Organization' } };

/** Each pull request as `pr get --include reviews,checks,commits,files` prints it, oldest first, numbered in the order they were opened. */
export function buildPrs(base: number, placed: Placed[]): Array<Record<string, unknown>> {
  const sorted = [...SPECS].sort((a, b) => a.created[0] - b.created[0] || a.created[1] - b.created[1]);
  return sorted.map((s, i) => {
    const number = 201 + i;
    const target = placed.find((p) => p.row.title.startsWith(s.item));
    if (!target) throw new Error(`The sample backlog has no item that starts "${s.item}".`);
    const title = `${target.key}: ${s.name ?? target.row.title}`;
    const when = (day: number, hour: number) => at(base, day, hour, between(rng(number * 97 + day * 13 + hour), 0, 59));
    const head = sha(`${number}-head`);
    const author = user(s.user);
    const created = when(...s.created);
    const mergedAt = s.merged ? when(...s.merged) : null;
    const reviews = (s.reviews ?? []).map((r, j) => ({ id: 90000 + number * 10 + j, user: user(r[0]), body: '', state: r[1], submitted_at: when(r[2], r[3]), commit_id: head, author_association: 'MEMBER' }));
    const last = [created, ...reviews.map((r) => r.submitted_at), ...(mergedAt ? [mergedAt] : [])].sort().at(-1)!;
    const additions = s.files.reduce((n, f) => n + f[1], 0);
    const deletions = s.files.reduce((n, f) => n + f[2], 0);
    return {
      url: `${GITHUB_API}/repos/${OWNER}/${REPO}/pulls/${number}`,
      id: 7000 + number,
      number,
      state: mergedAt ? 'closed' : 'open',
      locked: false,
      title,
      user: author,
      body: `Implements ${target.key}.`,
      draft: s.draft ?? false,
      html_url: `${GITHUB}/${OWNER}/${REPO}/pull/${number}`,
      created_at: created,
      updated_at: last,
      closed_at: mergedAt,
      merged_at: mergedAt,
      merge_commit_sha: sha(`${number}-merge`),
      requested_reviewers: (s.requested ?? []).map(user),
      requested_teams: [],
      labels: [],
      head: { label: `${OWNER}:${s.branch}`, ref: s.branch, sha: head, repo },
      base: { label: `${OWNER}:main`, ref: 'main', sha: sha('main'), repo },
      merged: mergedAt !== null,
      mergeable: mergedAt ? null : (s.mergeable ?? true),
      mergeable_state: mergedAt ? 'unknown' : s.mergeable === false ? 'dirty' : 'clean',
      comments: 0,
      review_comments: 0,
      commits: s.commits.length,
      additions,
      deletions,
      changed_files: s.files.length,
      included: {
        reviews,
        checks: s.checks.map((c, j) => ({
          id: 8000 + number * 10 + j,
          name: c[0],
          head_sha: head,
          status: c[1] === null ? 'in_progress' : 'completed',
          conclusion: c[1],
          html_url: `${GITHUB}/${OWNER}/${REPO}/actions/runs/${8000 + number * 10 + j}`,
          started_at: when(c[2], c[3]),
          completed_at: c[1] === null ? null : when(c[2], c[3]),
          app: { slug: 'github-actions', name: 'GitHub Actions' },
        })),
        commits: s.commits.map((message, j) => ({ sha: sha(`${number}-c${j}`), commit: { message, author: { name: author.login, email: 'you@example.com', date: created } }, author })),
        files: s.files.map(([path, a, d]) => ({ filename: path, status: 'modified', additions: a, deletions: d, changes: a + d })),
      },
    };
  });
}

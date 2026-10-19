import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import type { Agent } from '../src/agent.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { CANNED, FIXTURE_NOW, callKey, fixtureExecute, type Canned } from '../src/fixtures/execute.ts';
import type { Execute } from '../src/toil.ts';

/**
 * The views, rendered against the fixture `execute()` and the scripted Agent:
 * the same pair the site preview runs on, used here as the test harness (#206).
 */

const item = (dossier: string, id: string) => `#/dossier/${dossier}/item/${encodeURIComponent(id)}`;
const ROUTES = ['#/', '#/dossier/card-payments', '#/dossier/settlement', '#/dossier/checkout-web', item('card-payments', 'corp-jira:PAY-101'), '#/settings'];

async function open(hash: string, { preview = true, execute = fixtureExecute().execute, agent = scriptedAgent() }: { preview?: boolean; execute?: Execute; agent?: Agent } = {}) {
  window.location.hash = hash;
  const view = render(<App execute={execute} agent={agent} now={FIXTURE_NOW} preview={preview} />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  return view;
}

/** axe's rules, less colour contrast, which jsdom can't compute (themes.test.ts checks the tokens). */
async function violations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const panel = (name: string | RegExp) => screen.getByRole('region', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('every view', () => {
  it.each(ROUTES)('%s carries the preview banner, the views and when the data was read', async (hash) => {
    await open(hash);
    expect(screen.getByRole('note')?.textContent).toContain('Preview of an unreleased product.');
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('link')[0]!.textContent).toBe('Dossiers');
    expect(screen.getByText(/Sample data read 13 Oct 2026, 08:00 UTC through toil, read-only/)).toBeTruthy();
  });

  it.each(ROUTES.flatMap((r) => [[r, 'plain'], [r, 'crate']]))('%s in %s has no axe violations', async (hash, theme) => {
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme }));
    const { container } = await open(hash);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(await violations(container)).toEqual([]);
  });

  it('has no banner outside the preview', async () => {
    await open('#/', { preview: false });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('marks the current view in the navigation', async () => {
    await open('#/dossier/settlement');
    expect(screen.getByRole('link', { name: 'settlement' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dossiers' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('the dossier list', () => {
  it('lists three dossiers, each mixing its own sources, with a link to its dashboard', async () => {
    await open('#/');
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['card-payments', 'settlement', 'checkout-web']);
    expect(cards[0]!.textContent).toContain('Bitbucket, Jenkins, Jira, OpenShift');
    expect(cards[1]!.textContent).toContain('Azure DevOps');
    expect(cards[2]!.textContent).toContain('GitHub, OpenShift');
    expect(within(cards[2]!).getByRole('link').getAttribute('href')).toBe('#/dossier/checkout-web');
  });

  it('says which commands fed it', async () => {
    await open('#/');
    expect(screen.getByText(/Fed by/).textContent).toContain('toil dossiers list');
    expect(screen.getByText(/Fed by/).textContent).toContain('toil dossiers show ×3');
  });
});

describe('a dashboard', () => {
  it.each([
    ['card-payments', ['jira search', 'jira get-changelog'], ['bitbucket list-prs'], ['jenkins pipeline list-runs'], ['openshift deployments']],
    ['settlement', ['ado work list-iterations', 'ado work search', 'ado work get-batch', 'ado work revisions'], ['ado repo list-prs'], ['ado pipeline list-runs'], ['ado pipeline list-runs']],
    ['checkout-web', ['github projects list-items', 'github get-issue', 'github issue-events'], ['github list-prs'], ['github list-checks'], ['openshift deployments']],
  ])('%s names the commands that fed each panel', async (name, work, prs, builds, deployments) => {
    await open(`#/dossier/${name}`);
    const fed = (region: HTMLElement) => within(region).getByText(/Fed by/).textContent;
    for (const c of work) expect(fed(panel(/^Sprint 42: day/))).toContain(`toil ${c}`);
    for (const c of prs) expect(fed(panel('Pull requests'))).toContain(`toil ${c}`);
    for (const c of builds) expect(fed(panel('Builds'))).toContain(`toil ${c}`);
    for (const c of deployments) expect(fed(panel('Deployments'))).toContain(`toil ${c}`);
  });

  it('shows a story with its pull request, its build and where it runs, in one row', async () => {
    await open('#/dossier/card-payments');
    const row = (name: RegExp) => screen.getAllByRole('rowheader', { name }).find((r) => r.closest('table.trace'))!.closest('tr')!;
    expect(row(/PAY-105/).textContent).toContain('#298 PAY-105 Show the last four digits on receipts');
    expect(row(/PAY-105/).textContent).toContain('SUCCESS');
    expect(row(/PAY-105/).textContent).toContain('dev');
    expect(row(/PAY-101/).textContent).toContain('FAILURE');
    expect(row(/PAY-101/).textContent).toContain('Latest build failed');
    expect(row(/PAY-101/).textContent).toContain('Not deployed');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Only items with something to check' }));
    const trace = document.querySelector('table.trace') as HTMLElement;
    expect(within(trace).getAllByRole('rowheader').map((r) => r.textContent)).toEqual([expect.stringContaining('PAY-101')]);
  });

  it('lists what each environment runs and what that includes', async () => {
    await open('#/dossier/checkout-web');
    const deployments = panel('Deployments');
    const envs = within(deployments).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(envs).toEqual(['staging', 'prod']);
    expect(deployments.textContent).toContain('2026.10.12, commit 5a7e3f1');
    expect(deployments.textContent).toContain('Includes 2 merged pull requests, for GitHub payments-web#44');
    expect(deployments.textContent).toContain('Includes 1 merged pull request, none for this sprint');
  });

  it("shows the sprint's figures and each risk's reasons", async () => {
    await open('#/dossier/settlement');
    const sprint = panel(/^Sprint 42: day/);
    expect(sprint.querySelector('h2')!.textContent).toBe('Sprint 42: day 7 of 9');
    expect(within(sprint).getByRole('list', { name: 'Sprint figures' }).textContent).toContain('Done1 of 16points, 2 items');
    expect(sprint.textContent).toContain('Blocked by Azure DevOps 2302');
    expect(sprint.textContent).toContain('Points totals leave out items estimated in other units: Azure DevOps 2305');
  });

  it('answers a starter question about the dossier, streaming, with links to every item it cites', async () => {
    await open('#/dossier/settlement');
    const chat = screen.getByRole('complementary', { name: 'Ask about settlement' });
    await userEvent.click(within(chat).getByRole('button', { name: 'Where is this work deployed?' }));
    const answer = await within(chat).findByRole('heading', { level: 3, name: 'Where is this work deployed?' });
    const pane = answer.parentElement!;
    await waitFor(() => expect(pane.textContent).toContain('Answered by: a scripted preview, not a model.'));
    expect(within(pane).getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(item('settlement', 'corp-ado:2305'));
    expect(within(chat).getByRole('log').getAttribute('aria-busy')).toBe('false');
    expect(within(chat).getByText('You asked:', { exact: false }).closest('.bubble')!.textContent).toBe('You asked: Where is this work deployed?');
  });

  it("shows the agent's proposals as cards to review, with the command and no way to apply them", async () => {
    await open('#/dossier/settlement');
    const chat = screen.getByRole('complementary', { name: 'Ask about settlement' });
    await userEvent.click(within(chat).getByRole('button', { name: "What's at risk in this dossier?" }));
    const card = await within(chat).findByRole('article', { name: 'Proposal: Move 2303 to Sprint 43' });
    expect(card.textContent).toContain('Proposed change, not applied');
    expect(within(card).getByText(/^toil ado work update/).textContent).toBe('toil ado work update --dossier settlement --id 2303 --field "System.IterationPath=Payments\\\\Sprint 43" --allow-write');
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy command', 'Dismiss']);
    await userEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(within(chat).queryByRole('article', { name: /^Proposal:/ })).toBeNull();
  });

  it('answers a typed question, and says plainly when the preview has no answer for it', async () => {
    await open('#/dossier/checkout-web');
    const chat = screen.getByRole('complementary', { name: 'Ask about checkout-web' });
    await userEvent.type(within(chat).getByRole('textbox', { name: 'Your question' }), 'Should we cut scope?');
    await userEvent.click(within(chat).getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(chat.textContent).toMatch(/answers only its starter questions/));
    expect(within(chat).getByRole('textbox', { name: 'Your question' })).toHaveProperty('value', '');
  });
});

describe('the views on a dashboard (#252, #253)', () => {
  it('ranks what needs attention, each insight with its source', async () => {
    await open('#/dossier/card-payments');
    const list = within(panel('Needs attention')).getAllByRole('listitem').filter((li) => li.classList.contains('attention-item'));
    expect(list.map((li) => within(li).getAllByRole('link')[0]!.textContent)).toEqual(['Jira PAY-102 Store tokens in the vault', 'Jira PAY-104 Refund total rounds half-cents down', 'Jira PAY-101 Tokenise card numbers at the edge', 'Jira PAY-103 Charge a stored token', 'Jira PAY-107 Retry declined charges once']);
    expect(list[1]!.textContent).toContain('In progress for 13.9 days');
    expect(list[1]!.textContent).toContain('Source: history.transitions, against 6 cycle times');
  });

  it('puts each sprint item on the board under its status category, with its own status word and insights', async () => {
    await open('#/dossier/settlement');
    const board = panel('Sprint 42 board');
    const col = (name: string) => within(board).getByRole('region', { name: new RegExp(`^${name}`) });
    const cards = (region: HTMLElement) => within(region).getAllByRole('listitem').filter((li) => li.classList.contains('card'));
    expect(cards(col('To do')).map((c) => within(c).getAllByRole('link')[0]!.textContent)).toEqual(['Azure DevOps 2303', 'Azure DevOps 2306']);
    const card = cards(col('In progress')).find((li) => li.textContent?.includes('2304'))!;
    expect(card.textContent).toContain('Active · In progress');
    expect(card.textContent).toContain('Aging');
    expect(card.textContent).toContain('M. Lind');
  });

  it('turns a move into a proposal card naming the toil command, and changes nothing', async () => {
    const fixture = fixtureExecute();
    await open('#/dossier/card-payments', { execute: fixture.execute });
    const before = fixture.calls.length;
    const board = panel('Sprint 42 board');
    await userEvent.click(within(board).getByRole('button', { name: 'Move PAY-102 to…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }));
    const card = within(board).getByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.textContent).toContain('toil jira transition-issue --dossier card-payments --key PAY-102 --transition "In Progress" --allow-write');
    expect(screen.getByText(/Proposed: Move PAY-102 to In progress. Nothing has changed/)).toBeTruthy();
    // The card is still where Jira says it is, and nothing was asked of toil.
    expect(within(within(board).getByRole('region', { name: /^To do/ })).getByText('Store tokens in the vault')).toBeTruthy();
    expect(fixture.calls.length).toBe(before);
  });

  it('draws throughput, cycle time and aging, each listing what it could not compute', async () => {
    await open('#/dossier/checkout-web');
    expect(within(panel('Throughput')).getAllByRole('img').length).toBeGreaterThan(0);
    expect(panel('Throughput').textContent).toContain('3 finished in 6 weeks');
    expect(panel('Cycle time').textContent).toContain('No finished item here has a cycle time the data can show.');
    expect(panel('Cycle time').textContent).toContain('Unknown: Never recorded as In progress before Done.');
    expect(panel('Aging work in progress').textContent).toContain('Unknown: No move into In progress recorded.');
  });

  it('draws the dependency graph, and lists every link in words', async () => {
    await open('#/dossier/card-payments');
    const graph = panel('Dependencies');
    await waitFor(() => expect(graph.querySelector('.react-flow')).not.toBeNull());
    expect([...graph.querySelectorAll(':scope > ul.rows > li')].map((li) => li.textContent)).toEqual([
      'Jira PAY-101 Tokenise card numbers at the edge blocks Jira PAY-102 Store tokens in the vault (blocks)',
      'Jira PAY-102 Store tokens in the vault blocks Jira PAY-103 Charge a stored token (blocks)',
      'Jira PAY-103 Charge a stored token relates to Jira PAY-107 Retry declined charges once (relates to)',
    ]);
  });

  it('says so when a dossier has no links to draw', async () => {
    await open('#/dossier/checkout-web');
    await waitFor(() => expect(panel('Dependencies').textContent).toContain("No links between this dossier's items."));
  });

  it("charts the sprint's burn-up with its figures in a table", async () => {
    await open('#/dossier/settlement');
    const sprint = panel(/^Sprint 42: day/);
    expect(sprint.querySelector('svg.chart title')!.textContent).toBe('Sprint 42 burn-up: 1 of 16 points done after 9 days, with 3 days to go. Scope grew from 11 to 16 points.');
    expect(within(sprint).getByRole('table', { name: 'Sprint 42 burn-up by day' })).toBeTruthy();
  });
});

describe('the chat on a narrow screen', () => {
  it('is a sheet that opens and closes, with its question box inside', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      await open('#/dossier/card-payments');
      const chat = screen.getByRole('complementary', { name: 'Ask about card-payments' });
      const toggle = within(chat).getByRole('button', { name: 'Open' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(within(chat).queryByRole('textbox')).toBeNull();
      await userEvent.click(toggle);
      expect(within(chat).getByRole('button', { name: 'Hide' }).getAttribute('aria-expanded')).toBe('true');
      expect(within(chat).getByRole('textbox', { name: 'Your question' })).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('settings', () => {
  it('is in the navigation, and says the preview changes nothing', async () => {
    await open('#/settings');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("toil's configuration");
    expect(document.body.textContent).toContain('The preview has no configuration to change');
  });
});

describe('failures', () => {
  it("shows a failed call on its own panel with toil's message and fix, and the rest still loads", async () => {
    const without = (c: Canned) => !(c.command === 'bitbucket list-prs');
    await open('#/dossier/card-payments', { execute: fixtureExecute(CANNED.filter(without)).execute });
    const prs = panel('Pull requests');
    expect(within(prs).getByRole('alert').textContent).toMatch(/toil bitbucket list-prs failed: The preview has no sample answer .* Add the call to CANNED/);
    expect(panel(/^Sprint 42: day/).textContent).toContain('At risk');
  });

  it('says the data did not load when dossiers show fails', async () => {
    const execute = fixtureExecute(CANNED.filter((c) => callKey(c.command, c.input) !== callKey('dossiers show', { dossier: 'settlement' }))).execute;
    await open('#/dossier/settlement', { execute });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("The data didn't load");
    expect(alert.textContent).toContain('dossiers show');
  });

  it('says the agent failed, in the answer pane, when ask() rejects', async () => {
    const agent: Agent = { starters: scriptedAgent().starters, ask: () => Promise.reject(new Error('model endpoint unreachable')) };
    await open('#/dossier/checkout-web', { agent });
    await userEvent.click(await screen.findByRole('button', { name: "What's at risk in this dossier?" }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("The agent couldn't answer: model endpoint unreachable");
    expect(screen.getByRole('button', { name: "What's at risk in this dossier?" }).hasAttribute('disabled')).toBe(false);
  });
});

describe('an item', () => {
  it('shows each mapped field with where it came from, its pull requests and where it runs', async () => {
    await open(item('settlement', 'corp-ado:2305'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Schedule the export job');
    expect(screen.getByText('Microsoft.VSTS.Scheduling.OriginalEstimate')).toBeTruthy();
    expect(screen.getByText(/read with/).textContent).toContain('toil ado work get-batch');
    expect(screen.getByRole('link', { name: 'Schedule the settlement export job' }).getAttribute('href')).toBe('https://ado.imagile.dev/DefaultCollection/Payments/_git/settlement/pullrequest/84');
    expect(screen.getByText(/settlement-deploy 20261008.1/).textContent).toContain('test');
  });

  it('shows its insights, each with its source, and its time in progress', async () => {
    await open(item('settlement', 'corp-ado:2304'));
    const box = screen.getByRole('region', { name: 'Insights' });
    expect(box.textContent).toContain('Aging');
    expect(box.textContent).toContain('Carried over from Payments\\Sprint 41');
    expect(box.textContent).toContain('Source: history.iterations');
    expect(box.textContent).toMatch(/In progress for 15 days, since 28 Sept? 2026, 09:00 UTC/);
  });

  it('says so when the item is not in the dossier, with a way back', async () => {
    await open('#/dossier/card-payments/item/corp-jira%3ANOPE-1');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('No such item');
    expect(screen.getByRole('link', { name: 'Back to card-payments' }).getAttribute('href')).toBe('#/dossier/card-payments');
  });
});

describe('keyboard and focus', () => {
  it('starts with a skip link, and a new view moves focus to its heading', async () => {
    await open('#/');
    (document.activeElement as HTMLElement | null)?.blur(); // Start from the top of the page.
    await userEvent.tab();
    expect(document.activeElement?.textContent).toContain('Skip to content');
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Dossiers' }));
    await act(async () => {
      window.location.hash = '#/dossier/checkout-web';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'checkout-web' })));
  });
});

describe('themes', () => {
  it('switches between Plain and Crate without changing the layout, and remembers the choice', async () => {
    await open('#/dossier/card-payments');
    const before = screen.getAllByRole('button').map((b) => b.textContent);
    expect(document.documentElement.dataset.theme).toBe('plain');
    expect(screen.getByRole('button', { name: /Appearance/ })).toBeTruthy();
    expect(document.querySelector('.ask img')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Theme/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Crate' }));
    expect(document.documentElement.dataset.theme).toBe('crate');
    // Crate is dark only, so there's no appearance to choose; its crate stars in the empty state.
    expect(screen.queryByRole('button', { name: /Appearance/ })).toBeNull();
    expect(document.querySelector('.ask img')?.getAttribute('alt')).toBe('');
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter((t) => !/Plain|Crate|System/.test(t ?? ''))).toEqual(before.filter((t) => !/Plain|Crate|System/.test(t ?? '')));
    expect(JSON.parse(localStorage.getItem('toil-ui.theme')!)).toEqual({ theme: 'crate', scheme: 'system' });
  });

  it('takes the theme and scheme from the address first', async () => {
    window.history.replaceState(null, '', '/?theme=plain&scheme=dark');
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'crate' }));
    await open('#/');
    expect(document.documentElement.dataset.theme).toBe('plain');
    expect(document.documentElement.dataset.scheme).toBe('dark');
    window.history.replaceState(null, '', '/');
  });
});

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import type { Agent } from '../src/agent.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { CANNED, FIXTURE_NOW, callKey, fixtureExecute, type Canned } from '../src/fixtures/execute.ts';
import type { Execute } from '../src/toil.ts';
import type { ConfigApi } from '../src/config.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import type { AgentSettingsPanelProps } from '../src/agent-settings.tsx';
import type { AgentSettings, AgentStatus } from '../src/server-client.ts';

/**
 * The views, rendered against the fixture `execute()` and the scripted Agent:
 * the same pair the site preview runs on, used here as the test harness (#206).
 */

const item = (dossier: string, id: string) => `#/dossier/${dossier}/item/${encodeURIComponent(id)}`;
const ROUTES = ['#/', '#/dossier/card-payments', '#/dossier/settlement', '#/dossier/checkout-web', item('card-payments', 'corp-jira:PAY-101'), '#/settings', '#/settings/dossiers', '#/settings/toil', '#/settings/agent'];

async function open(hash: string, { preview = true, execute = fixtureExecute().execute, agent = scriptedAgent(), config = fixtureConfig(), agentSettings }: { preview?: boolean; execute?: Execute; agent?: Agent; config?: ConfigApi; agentSettings?: AgentSettingsPanelProps } = {}) {
  window.location.hash = hash;
  const view = render(<App execute={execute} agent={agent} config={config} now={FIXTURE_NOW} preview={preview} {...(agentSettings ? { agentSettings } : {})} />);
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
    // axe over a whole dossier view in jsdom takes 1–2s here and over 5s on a busy Windows runner.
  }, 30_000);

  it('names the app "toil UI" in the header, by its own words: the wordmark, then the sticker, read as one link home (#272, #277)', async () => {
    await open('#/dossier/settlement');
    const home = screen.getByRole('link', { name: 'toil UI' });
    expect(home.getAttribute('href')).toBe('#/');
    expect(home.querySelector('.wordmark')?.textContent).toBe('toil');
    expect(home.querySelector('.sticker')?.textContent).toBe('UI');
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
    ['card-payments', ['jira issue search', 'jira issue history'], ['bitbucket pr list'], ['jenkins pipeline runs'], ['openshift deployment list']],
    ['settlement', ['ado work-item iterations', 'ado work-item search', 'ado work-item get-many', 'ado work-item history'], ['ado pr list'], ['ado run list'], ['ado run list']],
    ['checkout-web', ['github project items', 'github issue get', 'github issue history'], ['github pr list'], ['github commit checks'], ['openshift deployment list']],
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
    const row = (name: RegExp) => screen.getAllByRole('rowheader', { name }).find((r) => r.closest('.trace'))!.closest('tr')!;
    expect(row(/PAY-105/).textContent).toContain('#298 PAY-105 Show the last four digits on receipts');
    expect(row(/PAY-105/).textContent).toContain('SUCCESS');
    expect(row(/PAY-105/).textContent).toContain('dev');
    expect(row(/PAY-101/).textContent).toContain('FAILURE');
    expect(row(/PAY-101/).textContent).toContain('Latest build failed');
    expect(row(/PAY-101/).textContent).toContain('Not deployed');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Only items with something to check' }));
    const trace = document.querySelector('.trace table') as HTMLElement;
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
    // jsdom has no platform, so the viewer's shell is POSIX; the toggle switches it, for every card.
    expect(within(card).getByText(/^toil ado work-item update/).textContent).toBe("toil ado work-item update '2303' --dossier 'settlement' --field 'System.IterationPath=Payments\\Sprint 43' --allow-write");
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy command', 'Dismiss']);
    await userEvent.click(within(card).getByRole('radio', { name: 'PowerShell' }));
    expect(within(card).getByRole('radio', { name: 'PowerShell' })).toHaveProperty('checked', true);
    expect(within(card).getByText(/^toil ado work-item update/).textContent).not.toContain('"');
    expect(localStorage.getItem('toil-ui.shell')).toBe('powershell');
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
    // A browser names it "Move PAY-102 to…"; jsdom's name computation drops the space that leads the hidden words.
    await userEvent.click(within(board).getByRole('button', { name: /^Move ?PAY-102 to…$/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }));
    const card = within(board).getByRole('article', { name: 'Proposal: Move PAY-102 to In progress' });
    expect(card.textContent).toContain("toil jira issue transition 'PAY-102' --dossier 'card-payments' --transition 'In Progress' --allow-write");
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
    localStorage.setItem('toil-ui.theme', JSON.stringify({ theme: 'plain' }));
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
    expect(document.body.textContent).toContain('Changes are turned off.');
    expect(document.body.textContent).toContain('it has no configuration of yours to change');
  });

  /** The preview's config with changes on, recording what each change sent, and answering it ok. */
  function recording() {
    const base = fixtureConfig();
    const sent: Array<{ command: string; input: Record<string, unknown>; answers: unknown }> = [];
    const config: ConfigApi = {
      ...base,
      disabled: null,
      run: async (command, input, answers) => {
        if (['connections list', 'connections test', 'dossiers list', 'dossiers show', 'dossiers check'].includes(command)) return base.run(command, input);
        sent.push({ command, input, answers: answers ?? null });
        return { ok: true, data: {}, error: null, meta: { command, durationMs: 0, version: 'x', contractVersion: 1 } };
      },
    };
    return { config, sent };
  }

  it('in the preview, shows the connections with every change turned off, and still tests one', async () => {
    await open('#/settings/connections');
    const card = await screen.findByRole('article', { name: 'corp-jira' });
    await userEvent.click(within(card).getByRole('button', { name: 'Turn writes off' }));
    const form = within(card).getByRole('form', { name: 'Turn writes off for corp-jira' });
    expect((within(form).getByRole('button', { name: 'Turn writes off' }) as HTMLButtonElement).disabled).toBe(true);
    expect(form.textContent).toContain('Turned off: This is the preview');
    expect(form.textContent).toContain('Runs toil connections writes corp-jira off');
    await userEvent.click(within(card).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(card.textContent).toContain('corp-jira answered GET /rest/api/2/myself, so its credential works.'));
  });

  it('shows a connection made by env vars read-only, with where it came from', async () => {
    await open('#/settings/connections');
    const card = await screen.findByRole('article', { name: 'github' });
    expect(within(card).queryByRole('button', { name: /Remove|Make default|Turn writes|Replace secret/ })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Test' })).toBeTruthy();
    expect(card.textContent).toContain('TOIL_CONN_GITHUB_*');
    expect(card.textContent).toContain('token: CI variable');
  });

  it("turns writes on only with the name typed, and sends what was typed as the command's own confirmation", async () => {
    const { config, sent } = recording();
    await open('#/settings/connections', { config });
    const card = await screen.findByRole('article', { name: 'corp-ado' });
    await userEvent.click(within(card).getByRole('button', { name: 'Turn writes on' }));
    const form = within(card).getByRole('form', { name: 'Turn writes on for corp-ado' });
    await userEvent.type(within(form).getByRole('textbox', { name: /Type corp-ado to turn them on/ }), 'corp-ado');
    await userEvent.click(within(form).getByRole('button', { name: 'Turn writes on' }));
    expect(await within(form).findByRole('status')).toBeTruthy();
    expect(sent).toEqual([{ command: 'connections writes', input: { name: 'corp-ado', state: 'on' }, answers: { answers: { 'confirm-name': 'corp-ado' } } }]);
  });

  it("adds a connection: every setting answered, the secret sent once and cleared from the page", async () => {
    const { config, sent } = recording();
    await open('#/settings/connections', { config });
    const form = await screen.findByRole('form', { name: 'A new connection' });
    await userEvent.type(within(form).getByRole('textbox', { name: /^Name/ }), 'corp-jira-2');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Area' }), 'jira');
    await userEvent.type(within(form).getByRole('textbox', { name: /^baseUrl/ }), 'https://jira.imagile.dev');
    const secret = within(form).getByLabelText(/^apiToken/) as HTMLInputElement;
    expect(secret.type).toBe('password');
    await userEvent.type(secret, 'fake-pat-abc12345');
    expect(form.textContent).toContain('Saves: area jira, baseUrl https://jira.imagile.dev, apiToken to the OS credential store.');
    await userEvent.click(within(form).getByRole('button', { name: 'Save connection' }));
    expect(await within(form).findByRole('status')).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ command: 'connections add', input: { name: 'corp-jira-2', area: 'jira' }, answers: { secrets: { apiToken: 'fake-pat-abc12345' } } });
    const answers = (sent[0]!.answers as { answers: Record<string, string> }).answers;
    expect(answers).toMatchObject({ confirm: 'y', 'setting:baseUrl': 'https://jira.imagile.dev', 'setting:project': '' });
    expect((within(form).getByLabelText(/^apiToken/) as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('fake-pat-abc12345');
  });

  it("answers an optional secret left blank with '', so toil skips it as the CLI does", async () => {
    const { config, sent } = recording();
    await open('#/settings/connections', { config });
    const form = await screen.findByRole('form', { name: 'A new connection' });
    await userEvent.type(within(form).getByRole('textbox', { name: /^Name/ }), 'ocp-lab');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Area' }), 'openshift');
    expect((within(form).getByLabelText(/^token/) as HTMLInputElement).required).toBe(false);
    await userEvent.click(within(form).getByRole('button', { name: 'Save connection' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ command: 'connections add', input: { name: 'ocp-lab', area: 'openshift' }, answers: { secrets: { token: '' } } });
  });

  it("replaces a secret with every field answered, an empty one as ''", async () => {
    const { config, sent } = recording();
    await open('#/settings/connections', { config });
    const card = await screen.findByRole('article', { name: 'corp-jenkins' });
    await userEvent.click(within(card).getByRole('button', { name: 'Replace secret' }));
    const form = within(card).getByRole('form', { name: "Replace corp-jenkins's secret" });
    await userEvent.click(within(form).getByRole('button', { name: 'Save to the credential store' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ command: 'connections login', input: { name: 'corp-jenkins' }, answers: { secrets: { apiToken: '' } } });
  });

  it('builds a dossier through toil dossiers, and shows and checks one', async () => {
    const { config, sent } = recording();
    await open('#/settings/dossiers', { config });
    const card = await screen.findByRole('article', { name: 'settlement' });
    await userEvent.click(within(card).getByRole('button', { name: 'Check' }));
    expect(await within(card).findByText('settlement checks out: no problems.')).toBeTruthy();
    expect(within(card).getByText('settlement checks out: no problems.').closest('[role="status"]')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Show' }));
    expect(within(card).getByRole('table').textContent).toContain('corp-ado (dossier)');

    const init = screen.getByRole('form', { name: 'Create a dossier' });
    await userEvent.type(within(init).getByRole('textbox', { name: /^Name/ }), 'payments');
    await userEvent.click(within(init).getByRole('button', { name: 'Create dossier' }));
    const field = screen.getByRole('form', { name: 'Name a field in card-payments' });
    await userEvent.type(within(field).getByRole('textbox', { name: /^Alias/ }), 'storyPoints');
    await userEvent.type(within(field).getByRole('textbox', { name: /^Field id/ }), 'customfield_10002');
    await userEvent.click(within(field).getByRole('button', { name: 'Name field' }));
    const link = screen.getByRole('form', { name: 'Link an area to card-payments' });
    await userEvent.type(within(link).getByRole('textbox', { name: /^Keys to set/ }), 'project=PAY');
    await userEvent.click(within(link).getByRole('button', { name: 'Link area' }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map((s) => [s.command, s.input])).toEqual([
      ['dossiers init', { name: 'payments' }],
      ['dossiers field', { dossier: 'card-payments', area: 'jira', alias: 'storyPoints', id: 'customfield_10002' }],
      ['dossiers link', { dossier: 'card-payments', area: 'jira', set: ['project=PAY'] }],
    ]);
  });

  it('shows the bounds and the time limit read-only, with where each is set', async () => {
    await open('#/settings/toil');
    await screen.findByRole('heading', { name: 'Bounds' });
    expect(document.body.textContent).toContain('Held: commands read and write files only inside the workspace.');
    expect(document.body.textContent).toContain('/home/you/.toil/config.json');
    expect(document.body.textContent).toContain("120 s, toil's default");
    expect(screen.queryByRole('button', { name: /Save|Change/ })).toBeNull();
  });

  it("has an Agent page, which says what the local app offers and changes nothing in the preview", async () => {
    await open('#/settings/agent');
    expect(screen.getByRole('link', { name: 'Agent' }).getAttribute('aria-current')).toBe('page');
    const agentPanel = panel('Agent');
    for (const name of ['Claude', 'GitHub Copilot', 'Codex']) expect(agentPanel.textContent).toContain(name);
    expect(within(agentPanel).queryByRole('button')).toBeNull();
    expect(document.body.textContent).not.toContain('Changes are turned off.');
  });

  const STATUS = (settings: AgentSettings, installed = false): AgentStatus => ({
    settings,
    problem: null,
    kind: settings.adapter,
    adapters: [
      {
        name: 'claude',
        label: 'Claude',
        package: '@anthropic-ai/claude-agent-sdk',
        installed,
        cli: installed ? { path: '/usr/local/bin/claude', problem: null, fix: null } : { path: null, problem: "Toil UI found no claude on PATH, so it can't start Claude Code. It never downloads one.", fix: 'Install it.' },
        endpoints: ['anthropic', 'bedrock', 'foundry', 'vertex'],
      },
      { name: 'copilot', label: 'GitHub Copilot', package: '@github/copilot-sdk', installed: false, cli: { path: null, problem: 'Toil UI found no copilot on PATH.', fix: null }, endpoints: [] },
      { name: 'codex', label: 'Codex', package: '@openai/codex-sdk', installed: false, cli: { path: null, problem: 'Toil UI found no codex on PATH.', fix: null }, endpoints: [] },
    ],
  });

  it('in the local app, says plainly when no SDK is installed and names the three', async () => {
    const client = { status: async () => STATUS({ adapter: 'none', model: null, cliPath: null, endpoint: null, instructions: null, voice: null }), save: async (s: AgentSettings) => STATUS(s), prompt: async () => '' };
    const { container } = await open('#/settings/agent', { preview: false, agentSettings: { client } });
    const agentPanel = panel('Agent');
    await within(agentPanel).findByRole('radiogroup', { name: 'Adapter' });
    expect(agentPanel.textContent).toContain('None of the three agent SDKs is installed beside Toil UI: Claude (@anthropic-ai/claude-agent-sdk), GitHub Copilot (@github/copilot-sdk), Codex (@openai/codex-sdk).');
    expect(agentPanel.textContent).toContain('Toil UI found no claude on PATH');
    expect(within(agentPanel).queryByLabelText(/key|token/i)).toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it('saves the adapter, model, CLI path and Claude endpoint, and says so', async () => {
    const saves: AgentSettings[] = [];
    const changed: AgentStatus[] = [];
    const client = { status: async () => STATUS({ adapter: 'none', model: null, cliPath: null, endpoint: null, instructions: null, voice: null }, true), save: async (s: AgentSettings) => (saves.push(s), STATUS(s, true)), prompt: async () => '' };
    const { container } = await open('#/settings/agent', { preview: false, agentSettings: { client, onChange: (s) => changed.push(s) } });
    const agentPanel = panel('Agent');
    await userEvent.click(await within(agentPanel).findByRole('radio', { name: /^Claude/ }));
    await userEvent.type(within(agentPanel).getByRole('textbox', { name: /Model/ }), 'sonnet');
    await userEvent.click(within(agentPanel).getByRole('radio', { name: 'Amazon Bedrock' }));
    expect(await violations(container)).toEqual([]);
    await userEvent.click(within(agentPanel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(agentPanel).getByRole('status').textContent).toBe('Saved: Claude answers from the next question.'));
    expect(saves).toEqual([{ adapter: 'claude', model: 'sonnet', cliPath: null, endpoint: 'bedrock', instructions: null, voice: null }]);
    expect(changed).toHaveLength(1);
  });
});

describe('the agent pane, with a real adapter', () => {
  it('says plainly when no agent is set up', async () => {
    const agent: Agent = { notice: 'No agent is set up in this Toil UI. Claude, GitHub Copilot or Codex.', starters: () => [], ask: () => Promise.reject(new Error('none')) };
    await open('#/dossier/card-payments', { agent, preview: false });
    expect(screen.getByText(/No agent is set up in this Toil UI/).textContent).toContain('GitHub Copilot');
  });

  it("shows the server's checks above an answer: ids its tools never returned", async () => {
    const agent: Agent = {
      starters: () => [{ id: 'risk', label: 'Why is this sprint at risk?' }],
      ask: async () => ({
        prompt: 'Why is this sprint at risk?',
        parts: [{ text: '[[corp-jira:PAY-101]] and [[corp-jira:PAY-999]].' }],
        citations: ['corp-jira:PAY-101', 'corp-jira:PAY-999'],
        by: 'Claude',
        proposals: [],
        unverified: ['corp-jira:PAY-999'],
        warnings: ['This answer names an item its tools never returned: corp-jira:PAY-999. Treat it as unverified.'],
      }),
    };
    const { container } = await open('#/dossier/card-payments', { agent, preview: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Why is this sprint at risk?' }));
    const checks = await screen.findByLabelText('Checks on this answer');
    expect(checks.textContent).toContain('corp-jira:PAY-999');
    expect(screen.getByText(/Names 1 its tools never returned/)).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });
});

describe('failures', () => {
  it("shows a failed call on its own panel with toil's message and fix, and the rest still loads", async () => {
    const without = (c: Canned) => !(c.command === 'bitbucket pr list');
    await open('#/dossier/card-payments', { execute: fixtureExecute(CANNED.filter(without)).execute });
    const prs = panel('Pull requests');
    expect(within(prs).getByRole('alert').textContent).toMatch(/toil bitbucket pr list failed: The preview has no sample answer .* Add the call to CANNED/);
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
    expect(screen.getByText(/read with/).textContent).toContain('toil ado work-item get-many');
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
  it('opens in Crate, switches to Plain without changing the layout, and remembers the choice (#277)', async () => {
    await open('#/dossier/card-payments');
    const before = screen.getAllByRole('button').map((b) => b.textContent);
    expect(document.documentElement.dataset.theme).toBe('crate');
    // Crate is dark only, so there's no appearance to choose; its crate stars in the empty state.
    expect(screen.queryByRole('button', { name: /Appearance/ })).toBeNull();
    expect(document.querySelector('.ask img')?.getAttribute('alt')).toBe('');
    await userEvent.click(screen.getByRole('button', { name: /Theme/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Plain' }));
    expect(document.documentElement.dataset.theme).toBe('plain');
    expect(screen.getByRole('button', { name: /Appearance/ })).toBeTruthy();
    expect(document.querySelector('.ask img')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter((t) => !/Plain|Crate|System/.test(t ?? ''))).toEqual(before.filter((t) => !/Plain|Crate|System/.test(t ?? '')));
    expect(JSON.parse(localStorage.getItem('toil-ui.theme')!)).toEqual({ theme: 'plain', scheme: 'system', wording: true, voice: true });
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

describe('how deep the theme goes (#283)', () => {
  const setTheme = (theme: string, more: Record<string, unknown> = {}) => localStorage.setItem('toil-ui.theme', JSON.stringify({ theme, ...more }));

  it('says the empty states, loading lines and notes in the theme\'s words, and the standard ones with wording off', async () => {
    setTheme('crate');
    await open('#/dossier/checkout-web');
    await waitFor(() => expect(panel('Dependencies').textContent).toContain("No links between this dossier's items: every crate stands on its own."));
    expect(screen.getByText('Consignment')).toBeTruthy();
    cleanupView();
    setTheme('crate', { wording: false });
    await open('#/dossier/checkout-web');
    await waitFor(() => expect(panel('Dependencies').textContent).toContain("No links between this dossier's items."));
    expect(panel('Dependencies').textContent).not.toContain('every crate');
    expect(screen.getByText('Dossier')).toBeTruthy();
  });

  it('never changes a control, a heading or a figure: the same buttons, links and headings with wording on and off', async () => {
    const names = () => ['button', 'link', 'heading', 'checkbox', 'textbox'].flatMap((role) => screen.queryAllByRole(role).map((el) => `${role}: ${el.textContent}`));
    setTheme('realm', { wording: false });
    await open('#/dossier/card-payments');
    const off = names();
    cleanupView();
    setTheme('realm');
    await open('#/dossier/card-payments');
    expect(names()).toEqual(off.map((n) => n.replace(/^heading: Sprint 42(?=:)/, 'heading: Chronicle (Sprint 42').replace(/^(heading: Chronicle \(Sprint 42: day \d+ of \d+)$/, '$1)').replace(/^heading: Dependencies$/, 'heading: Map (Dependencies)')));
  });

  it('has both boxes on by default under the theme picker, and turns both off, with a note, for Plain', async () => {
    await open('#/settings/toil');
    const card = screen.getByRole('region', { name: 'Theme' });
    const wording = within(card).getByRole('checkbox', { name: 'Themed wording' }) as HTMLInputElement;
    const voice = within(card).getByRole('checkbox', { name: 'Themed agent voice' }) as HTMLInputElement;
    expect([wording.checked, voice.checked]).toEqual([true, true]);
    await userEvent.click(wording);
    expect(JSON.parse(localStorage.getItem('toil-ui.theme')!)).toMatchObject({ theme: 'crate', wording: false, voice: true });
    expect(within(card).getByRole('link', { name: 'the themes documentation (opens in a new tab)' }).getAttribute('href')).toBe('https://imagile-dev.github.io/toil/docs/themes/');
    cleanupView();
    setTheme('plain');
    const { container } = await open('#/settings/toil');
    const plain = screen.getByRole('region', { name: 'Theme' });
    for (const name of ['Themed wording', 'Themed agent voice']) {
      const box = within(plain).getByRole('checkbox', { name }) as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(true);
    }
    expect(plain.textContent).toContain('Plain has no wording or voice of its own, so both are off');
    expect(await violations(container)).toEqual([]);
  });

  it('answers in the theme\'s voice with the voice on, and in the standard words with it off', async () => {
    setTheme('crate');
    await open('#/dossier/card-payments');
    await userEvent.click(within(screen.getByRole('group', { name: 'Starter questions' })).getAllByRole('button')[0]!);
    expect(await screen.findByText(/3 of 21 points are on the truck/, {}, { timeout: 4000 })).toBeTruthy();
    cleanupView();
    setTheme('crate', { voice: false });
    await open('#/dossier/card-payments');
    await userEvent.click(within(screen.getByRole('group', { name: 'Starter questions' })).getAllByRole('button')[0]!);
    expect(await screen.findByText(/3 of 21 points are done and 18 remain/, {}, { timeout: 4000 })).toBeTruthy();
  });

  it('explains the answers from an (i) beside the questions, by keyboard, and closes on Escape', async () => {
    setTheme('harvest');
    const { container } = await open('#/dossier/settlement');
    const info = screen.getByRole('button', { name: 'About these answers' });
    info.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'About these answers' });
    expect(dialog.textContent).toContain("Answers are written in Harvest's voice, or in your own custom voice if you saved one. A voice changes their phrasing only");
    expect(dialog.textContent).toContain('Answered by a scripted preview, not a model.');
    expect(dialog.textContent).toContain('The agent only reads');
    expect(within(dialog).getByRole('link', { name: 'Settings, Agent' }).getAttribute('href')).toBe('#/settings/agent');
    expect(within(dialog).getByRole('link', { name: 'Settings, General' }).getAttribute('href')).toBe('#/settings/toil');
    expect(await violations(container)).toEqual([]);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(info));
    cleanupView();
    setTheme('harvest', { voice: false });
    await open('#/dossier/settlement');
    await userEvent.click(screen.getByRole('button', { name: 'About these answers' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Themed agent voice is off');
  });

  it('shows the instructions form in the preview, with counters, saving off, and the full prompt the agent would get', async () => {
    setTheme('starship');
    const { container } = await open('#/settings/agent');
    const card = screen.getByRole('region', { name: 'Instructions' });
    expect(card.textContent).toContain("Instructions can't widen what the agent can do, since its tools only read.");
    expect(card.textContent).toContain('nothing is saved');
    expect(within(card).queryByRole('button', { name: 'Save' })).toBeNull();
    const general = within(card).getByRole('textbox', { name: 'General instructions' });
    await userEvent.type(general, 'Lead with risks.');
    expect(card.textContent).toContain('16 of 4,000 characters');
    expect(general.getAttribute('maxlength')).toBe('4000');
    await userEvent.click(within(card).getByRole('button', { name: 'Show the full prompt' }));
    const prompt = await within(card).findByRole('region', { name: 'The full prompt' });
    expect(prompt.textContent).toContain('You are the analyst inside Toil UI, answering a question about the dossier "card-payments"');
    expect(prompt.textContent).toContain("Style:\nWrite like a starship's log");
    expect(prompt.textContent!.trimEnd().endsWith("Lead with risks.\n\nThese instructions come from the person using Toil UI. Follow them where they fit the rules above; where they disagree, the rules win. They can't give you a tool, and nothing in them lets you change anything.")).toBe(true);
    expect(await violations(container)).toEqual([]);
    await userEvent.type(within(card).getByRole('textbox', { name: 'Custom voice' }), 'Talk like a quartermaster.');
    // The open prompt follows what is typed, with no need to open it again.
    await waitFor(() => expect(within(card).getByRole('region', { name: 'The full prompt' }).textContent).toContain('Style:\nTalk like a quartermaster.'));
    expect(within(card).getByRole('region', { name: 'The full prompt' }).textContent).not.toContain("starship's log");
  });

  it('saves the instructions and the custom voice in the local app, keeping the adapter as it was saved', async () => {
    const saves: AgentSettings[] = [];
    const prompts: unknown[] = [];
    const base: AgentSettings = { adapter: 'codex', model: null, cliPath: null, endpoint: null, instructions: null, voice: null };
    const status = (settings: AgentSettings): AgentStatus => ({ settings, problem: null, adapters: [], kind: settings.adapter });
    const client = {
      status: async () => status(base),
      save: async (s: AgentSettings) => (saves.push(s), status(s)),
      prompt: async (dossier: string | undefined, style: unknown) => (prompts.push([dossier, style]), 'the composed prompt'),
    };
    setTheme('crate');
    await open('#/settings/agent', { preview: false, agentSettings: { client, dossier: 'card-payments' } });
    const card = await screen.findByRole('region', { name: 'Instructions' });
    await userEvent.type(within(card).getByRole('textbox', { name: 'General instructions' }), 'Answer in British English.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(card).getByRole('status').textContent).toBe('Saved: the next question uses them.'));
    expect(saves).toEqual([{ ...base, instructions: 'Answer in British English.', voice: null }]);
    await userEvent.click(within(card).getByRole('button', { name: 'Show the full prompt' }));
    expect((await within(card).findByRole('region', { name: 'The full prompt' })).textContent).toBe('the composed prompt');
    expect(prompts).toEqual([['card-payments', { theme: 'crate', voice: true }]]);
  });
});

/** Unmounts what open() rendered, so one test can open a view twice. */
function cleanupView() {
  cleanup();
  window.location.hash = '';
}

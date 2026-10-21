import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App, parseRoute } from '../src/App.tsx';
import { EditLink, Help } from '../src/components/help.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { DOCS_SITE, HELP, helpHref, viewHelpHref, type HelpView } from '../src/help.ts';
import { UI_DOC_PAGES, skillFiles, skillDir, uiDocDir } from '../../site/src/lib/skill-pages.mjs';

/**
 * Help topics and edit links (#346). Every Read more link has to land on a
 * real heading, so each topic's page is mapped to the markdown it renders and
 * its anchor is looked for among that file's headings, slugged the way the
 * site's build slugs them (github-slugger). The site build checks the same
 * links again against the HTML it built (site/scripts/check-help-links.mjs).
 */

const root = join(import.meta.dirname, '..', '..');

/** The markdown file a docs page renders. */
function sourceOf(page: string): string {
  if (page === '/docs/ui/') return join(root, 'ui', 'README.md');
  const ui = Object.entries(UI_DOC_PAGES).find(([, p]) => p === page)?.[0];
  if (ui) return join(uiDocDir, ui);
  const skill = skillFiles.find((f) => f.path === page);
  if (skill) return join(skillDir, skill.file);
  throw new Error(`No docs page renders ${page}`);
}

/** A heading's id as github-slugger makes it: lower case, punctuation and symbols dropped, spaces to hyphens, repeats numbered. */
function headingIds(markdown: string): string[] {
  const seen = new Map<string, number>();
  const ids: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('```')) fenced = !fenced;
    const m = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1]!.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.push(n ? `${base}-${n}` : base);
  }
  return ids;
}

describe('the help topics', () => {
  it('slugs headings the way the site does', () => {
    expect(headingIds("## Toil's configuration\n## Verify before you open a PR: `npm run verify:ui`\n## Worklog\n### Worklog")).toEqual(['toils-configuration', 'verify-before-you-open-a-pr-npm-run-verifyui', 'worklog', 'worklog-1']);
  });

  it.each(Object.entries(HELP))('%s links to a heading that exists', (_, topic) => {
    expect(headingIds(readFileSync(sourceOf(topic.page), 'utf8'))).toContain(topic.anchor);
    expect(helpHref(topic)).toBe(`${DOCS_SITE}${topic.page}#${topic.anchor}`);
  });

  it('keeps each topic to one or two sentences', () => {
    for (const [id, t] of Object.entries(HELP)) expect(t.text.split(/(?<=[.!?])\s+(?=[A-Z])/).length, id).toBeLessThanOrEqual(2);
  });

  it("gives every view the header's Help opens a topic", () => {
    const views: HelpView[] = ['dossiers', 'dashboard', 'prs', 'people', 'command-center', 'worklog', 'standup', 'item', 'assignment', 'settings'];
    for (const v of views) expect(viewHelpHref(v)).toMatch(new RegExp(`^${DOCS_SITE}/docs/[a-z-]+/#[a-z0-9-]+$`));
    expect(viewHelpHref('settings', 'agent')).toBe(helpHref(HELP.agent));
  });
});

describe('the (i)', () => {
  it('names its topic, shows its sentences on focus, and opens them with Read more when pressed', async () => {
    render(<Help topic="worklog" />);
    const button = screen.getByRole('button', { name: 'About the worklog' });
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(HELP.worklog.text));
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'About the worklog' });
    expect(within(dialog).getByText(HELP.worklog.text)).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: /^Read more/ });
    expect(link.getAttribute('href')).toBe('https://imagile-dev.github.io/toil/docs/ui/#worklog');
    expect(link.textContent).toBe('Read more about the worklog in the docs (opens in a new tab)');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('edit links', () => {
  it('is a link with the name it was given, and nothing else', () => {
    render(<EditLink href="#/settings/connections/corp-jira" label="Edit the corp-jira connection" />);
    const link = screen.getByRole('link', { name: 'Edit the corp-jira connection' });
    expect(link.getAttribute('href')).toBe('#/settings/connections/corp-jira');
  });

  it('routes a settings page to the place an edit link names', () => {
    expect(parseRoute('#/settings/connections/corp-jira')).toEqual({ view: 'settings', page: 'connections', at: ['corp-jira'] });
    expect(parseRoute('#/settings/dossiers/card-payments/wip')).toEqual({ view: 'settings', page: 'dossiers', at: ['card-payments', 'wip'] });
    expect(parseRoute('#/settings/agent-usage/caps')).toEqual({ view: 'settings', page: 'agent-usage', at: ['caps'] });
    expect(parseRoute('#/settings/dossiers')).toEqual({ view: 'settings', page: 'dossiers' });
    expect(parseRoute('#/settings/connections/100%')).toEqual({ view: 'settings', page: 'connections', at: ['100%'] });
  });

  const open = async (hash: string) => {
    window.location.hash = hash;
    render(<App execute={fixtureExecute().execute} agent={scriptedAgent()} config={fixtureConfig()} now={FIXTURE_NOW} preview />);
    await screen.findByRole('heading', { level: 1 });
  };

  it("lands on the connection it names, and says so when there's none", async () => {
    await open('#/settings/connections/corp-jira');
    await waitFor(() => expect(document.activeElement?.id).toBe('conn-corp-jira'));
    window.location.hash = '#/settings/connections/gone';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect((await screen.findByText(/toil has no connection named/)).textContent).toContain('gone');
  });

  it('lands on the dossier section it names, with that dossier chosen', async () => {
    await open('#/settings/dossiers/checkout-web/wip');
    await waitFor(() => expect(document.activeElement?.id).toBe('dossier-form-wip'));
    expect(document.activeElement?.textContent).toBe("Set checkout-web's work-in-progress limit");
  });

  it("puts a pencil on an item's connection and on the People view's limit, each opening its settings", async () => {
    await open(`#/dossier/card-payments/item/${encodeURIComponent('corp-jira:PAY-102')}`);
    expect(screen.getByRole('link', { name: 'Edit the corp-jira connection' }).getAttribute('href')).toBe('#/settings/connections/corp-jira');
    expect(screen.getByRole('link', { name: "Edit card-payments's field names" }).getAttribute('href')).toBe('#/settings/dossiers/card-payments/fields');
  });

  it('has a Help entry in the header for the view in front of you', async () => {
    await open('#/dossier/card-payments/people');
    expect(screen.getByRole('link', { name: /^Help/ }).getAttribute('href')).toBe(helpHref(HELP.people));
    expect(screen.getByRole('link', { name: "Edit card-payments's work-in-progress limit" }).getAttribute('href')).toBe('#/settings/dossiers/card-payments/wip');
  });
});

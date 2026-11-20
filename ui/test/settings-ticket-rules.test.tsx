// @vitest-environment jsdom
/**
 * Settings, Ticket rules (#657): the rule set picker leads, the library of sets
 * is one press in, a failed read says so in toil's words and never reads as
 * "no rules", a person may hold a Toil project to no rule sets at all, and a
 * new rule's id follows its name until it is saved.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConfigApi } from '../src/config.ts';
import { fixtureConfig } from '../src/fixtures/config.ts';
import type { Envelope } from '../src/toil.ts';
import { open, resetBrowserState } from './views-kit.tsx';

beforeEach(resetBrowserState);

const fail = (command: string, message: string, fix: string): Envelope => ({ ok: false, data: null, error: { code: 'NOT_FOUND', message, fix }, meta: { command, durationMs: 0, version: 'x', contractVersion: 1 } }) as Envelope;
const okEnv = (command: string, data: unknown): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 'x', contractVersion: 1 } }) as Envelope;

/** The preview's config with changes on: `over` answers a command first, every change is recorded and answered ok. */
function config(over: (command: string, input: Record<string, unknown>) => Promise<Envelope> | null = () => null) {
  const base = fixtureConfig();
  const sent: Array<{ command: string; input: Record<string, unknown> }> = [];
  const api: ConfigApi = {
    ...base,
    disabled: null,
    run: async (command, input, answers) => {
      const answered = over(command, input);
      if (answered) return answered;
      if (['standards save', 'standards remove', 'projects standards set'].includes(command)) {
        sent.push({ command, input });
        return okEnv(command, { revision: 1 });
      }
      return base.run(command, input, answers);
    },
  };
  return { config: api, sent };
}

describe('Settings, Ticket rules (#657)', () => {
  it('leads with the rule sets a Toil project uses, and keeps the library one press in, each set once', async () => {
    await open('#/settings/rules', { config: config().config });
    const picker = await screen.findByRole('region', { name: /Rules a Toil project uses/ });
    expect(await within(picker).findByRole('group', { name: 'Hold its items to' })).toBeTruthy();
    const library = document.querySelector<HTMLDetailsElement>('[data-rules-library] details')!;
    expect(library.open).toBe(false);
    // A set's card says whose it is in a word; its revision is the word's tooltip.
    const badge = document.querySelector('[data-rules-source]')!;
    expect(['Yours', 'Built in']).toContain(badge.textContent);
    expect(badge.getAttribute('title')).toMatch(/^Revision \d+$/);
    expect(document.body.textContent).not.toMatch(/revision \d/);
  });

  it("says a failed read of the Toil projects in toil's words, never as none", async () => {
    await open('#/settings/rules', { config: config((c) => (c === 'projects list' ? Promise.resolve(fail(c, 'The projects folder is unreadable.', 'Check its permissions.')) : null)).config });
    const failed = await waitFor(() => {
      const el = document.querySelector('[data-rules-use-failed]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(failed.textContent).toBe("Couldn't read your Toil projects: The projects folder is unreadable. Check its permissions.");
    expect(document.body.textContent).not.toContain('No Toil project yet');
  });

  it('says a thrown read of one Toil project, rather than reading it for ever', async () => {
    await open('#/settings/rules', { config: config((c) => (c === 'projects show' ? Promise.reject(new Error('The server went away.')) : null)).config });
    await waitFor(() => expect(document.querySelector('[data-rules-use-failed]')?.textContent).toMatch(/^Couldn't read .+: The server went away\.$/));
    expect(document.body.textContent).not.toMatch(/Reading card-payments…/);
  });

  it('offers to create a Toil project when there is none', async () => {
    await open('#/settings/rules', { config: config((c) => (c === 'projects list' ? Promise.resolve(okEnv(c, { toilProjects: [] })) : null)).config });
    const create = await screen.findByRole('link', { name: 'Create a Toil project' });
    expect(create.getAttribute('href')).toBe('#/settings/projects/+new');
    expect(create.className).toContain('btn');
  });

  it('holds a Toil project to no rule sets on a press, with no terminal command in sight', async () => {
    const { config: api, sent } = config();
    await open('#/settings/rules', { config: api });
    const none = await screen.findByRole('checkbox', { name: 'No rule sets' });
    await userEvent.click(none);
    expect(document.body.textContent).not.toContain('--clear');
    await userEvent.click(screen.getByRole('button', { name: 'Use no rule sets' }));
    await waitFor(() => expect(sent.at(-1)).toMatchObject({ command: 'projects standards set', input: { clear: true } }));
    expect(sent.at(-1)!.input).not.toHaveProperty('use');
  });

  it("gives a new rule an id from its name until the set is saved, and frames every button", async () => {
    const { config: api, sent } = config();
    await open('#/settings/rules', { config: api });
    await userEvent.click(await screen.findByText('Your rule sets'));
    await userEvent.click(screen.getByRole('button', { name: 'New set of rules' }));
    const editor = document.querySelector<HTMLElement>('[data-rules-editor]')!;
    await userEvent.type(within(editor).getByRole('textbox', { name: /^Name/ }), 'team-stories');
    await userEvent.click(within(editor).getByRole('button', { name: 'Add a rule' }));
    expect(editor.querySelector('[data-rule-edit]')!.getAttribute('data-rule-edit')).toBe('new-rule');
    const ruleName = within(editor.querySelector<HTMLElement>('[data-rule-edit]')!).getByRole('textbox', { name: /^Name/ });
    await userEvent.clear(ruleName);
    await userEvent.type(ruleName, 'Names the customer');
    expect(editor.querySelector('[data-rule-edit]')!.getAttribute('data-rule-edit')).toBe('names-the-customer');
    // One hint above the rules, not one under every rule's instructions.
    expect(editor.querySelectorAll('.rules-edit__hint')).toHaveLength(1);
    for (const name of ['Remove this rule', 'Cancel']) expect(within(editor).getByRole('button', { name }).className).toContain('btn--secondary');
    await userEvent.type(within(editor).getByRole('textbox', { name: 'Instructions' }), 'Every story names its customer.');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent.at(-1)?.command).toBe('standards save'));
    expect(JSON.parse(sent.at(-1)!.input.text as string).rules[0].id).toBe('names-the-customer');
  });
});

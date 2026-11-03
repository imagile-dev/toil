import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_AGENT_DETAILS, NO_AGENT_NOTICE, type Agent, type Answer } from '../src/agent.ts';
import { App } from '../src/App.tsx';
import { seenCounts } from '../src/components/guided.tsx';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { GROUPS, QUESTIONS } from '../src/guided-questions.ts';
import { resetPlain, setPlain } from '../src/plain-words.ts';
import { loaded } from './harness.ts';

/**
 * Ask with training wheels (#552): the guided start, "Before you ask", and
 * "How sure is this?" under an answer, in plain words and in toil's own. The
 * rule behind "How sure" is in confidence.test.ts; this is the chat it
 * decides.
 */

const PHONE = '(max-width: 699px)';
const { matchMedia } = window;

function screenWidth(phone: boolean) {
  window.matchMedia = ((query: string) => ({ matches: query === PHONE ? phone : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
}

const answer = (prompt: string, over: Partial<Answer> = {}): Answer => ({ prompt, parts: [{ text: 'Fine.' }], citations: [], by: 'Claude', proposals: [], ...over });

/** An agent that records what it is asked, answering with `reply`. */
function recording(reply: (prompt: string) => Answer = (p) => answer(p), extra: Partial<Agent> = {}) {
  const asked: string[] = [];
  const agent: Agent = { starters: () => [], ask: async (_d, prompt) => (asked.push(prompt), reply(prompt)), ...extra };
  return { agent, asked };
}

async function openChat(agent: Agent, dossier = 'card-payments', preview = true) {
  window.location.hash = `#/dossier/${dossier}`;
  render(<App execute={fixtureExecute().execute} agent={agent} now={FIXTURE_NOW} preview={preview} />);
  await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
  await userEvent.click(screen.getByRole('textbox', { name: 'Your question' }));
  return screen.findByRole('dialog', { name: `Ask about ${dossier}` });
}

beforeEach(() => {
  localStorage.clear();
  resetPlain();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  window.matchMedia = matchMedia;
  window.history.replaceState(null, '', '/');
});

describe('the guided start', () => {
  it('asks what the person would like to know, with plain questions in groups, each good for something, and the briefing first', async () => {
    const chat = await openChat(scriptedAgent());
    expect(within(chat).getByRole('heading', { level: 3, name: 'What would you like to know about card-payments?' })).toBeTruthy();
    const list = within(chat).getByRole('group', { name: 'Starter questions' });
    expect(within(list).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(GROUPS.map((g) => g.title));
    const buttons = within(list).getAllByRole('button');
    expect(buttons).toHaveLength(9);
    expect(buttons[0]!.textContent).toMatch(/^Give me the full briefing/);
    expect(buttons.every((b) => b.textContent!.includes('Good for: '))).toBe(true);
    expect(within(list).getByRole('button', { name: /^Who might need help\?/ }).textContent).toContain('never ranks anyone');
    // The person can still type their own, and there is no Analyze button beside it.
    expect(within(chat).getByRole('textbox', { name: 'Your question' })).toBeTruthy();
    expect(within(chat).queryByRole('button', { name: /Analyze|Get a briefing/ })).toBeNull();
  });

  it('asks a pressed question as typing it would, and the start gives way to the conversation', async () => {
    const { agent, asked } = recording();
    const chat = await openChat(agent);
    await userEvent.click(within(chat).getByRole('button', { name: /^What's blocking us\?/ }));
    await within(chat).findByText('Fine.');
    expect(asked).toEqual(["What's blocking us?"]);
    expect(within(chat).queryByRole('group', { name: 'Starter questions' })).toBeNull();
    // The same questions are the Suggestions menu from here on.
    await userEvent.click(within(chat).getByRole('button', { name: 'Suggestions' }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(GROUPS.flatMap((g) => g.questions).map((id) => QUESTIONS[id].text));
  });

  it('runs exactly what Analyze runs for "Give me the full briefing"', async () => {
    const { agent, asked } = recording(() => answer('Analyze'));
    const chat = await openChat(agent);
    await userEvent.click(within(chat).getByRole('button', { name: /^Give me the full briefing/ }));
    await within(chat).findByRole('heading', { level: 3, name: 'Analyze' });
    expect(asked).toEqual(['analyze']);
  });

  it('still lets the command palette run Analyze', async () => {
    const { agent, asked } = recording(() => answer('Analyze'));
    window.location.hash = '#/dossier/card-payments';
    render(<App execute={fixtureExecute().execute} agent={agent} now={FIXTURE_NOW} preview />);
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    await userEvent.click(await screen.findByText(/Get a briefing on/));
    await waitFor(() => expect(asked).toEqual(['analyze']));
  });

  it('wears toil\'s own words with plain words off: the same questions, a dossier named as one', async () => {
    setPlain(false);
    const chat = await openChat(scriptedAgent());
    expect(within(chat).getAllByRole('group', { name: 'Starter questions' })[0]!.querySelectorAll('button')).toHaveLength(9);
    expect(within(chat).getByText('See other dossiers')).toBeTruthy();
  });
});

describe('"Before you ask"', () => {
  it('is on the page beside the questions with what the AI can see, what it cannot do, who answers and what it costs', async () => {
    const chat = await openChat(scriptedAgent());
    const before = within(chat).getByRole('complementary', { name: 'Before you ask' });
    const { data } = await loaded('card-payments');
    const seen = [...before.querySelectorAll('[data-seen] li')].map((l) => l.textContent);
    expect(seen).toEqual([`${data.items.length} items`, `${data.pullRequests.length} code reviews`, `${data.changes.filter((c) => c.kind === 'build').length} builds`, `${data.deployments.length} deployments`]);
    expect(seen).toEqual(seenCounts(data).map((c) => c.replace('pull requests', 'code reviews').replace('pull request', 'code review')));
    for (const text of ['What the AI can see', "This Toil project's saved work:", 'looks things up live', 'Change anything in', 'See email or chat', 'See other Toil projects', 'Who answers', 'counts toward your usage']) expect(before.textContent).toContain(text);
    expect(before.textContent).toContain('a scripted preview, not a model');
    expect(within(before).queryByRole('button', { name: 'What AI can see' })).toBeNull();
  });

  it('folds to one line under 700px, below the questions, with a button that opens it', async () => {
    screenWidth(true);
    const chat = await openChat(scriptedAgent());
    const before = within(chat).getByRole('complementary', { name: 'Before you ask' });
    expect(before.textContent).toContain("It reads this Toil project's saved work. It changes nothing.");
    expect(before.textContent).not.toContain('Who answers');
    // Last in the page's order, so a phone reads the questions first.
    const groups = within(chat).getByRole('group', { name: 'Starter questions' });
    expect(groups.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const toggle = within(before).getByRole('button', { name: 'What AI can see' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(before.textContent).toContain('Who answers');
  });
});

describe('"How sure is this?"', () => {
  it('sits under a finished answer with a word and a sentence, what it looked at as links, and that nothing changed', async () => {
    const chat = await openChat(scriptedAgent(), 'settlement');
    await userEvent.click(within(chat).getByRole('button', { name: /^Are we going to finish the sprint\?/ }));
    const checks = await waitFor(() => {
      const c = chat.querySelector('[data-how-sure]');
      if (!c) throw new Error('not yet');
      return c as HTMLElement;
    });
    expect(within(checks).getByText('How sure is this?')).toBeTruthy();
    const word = checks.querySelector('[data-sure]')!;
    expect(['High', 'Medium', 'Low']).toContain(word.textContent);
    // The sample's data is two hours old, every read worked, and it names the items its answer rests on.
    expect(checks.textContent).toMatch(/data was read 2 hours ago|items have no estimate/);
    expect(within(checks).getAllByRole('link').length).toBeGreaterThan(0);
    expect(within(checks).getByText('What it looked at')).toBeTruthy();
    expect(checks.textContent).toContain('Suggestions only. Nothing was changed.');
  });

  it('judges a typed question by the generic checks only: every read, the age and the items', async () => {
    const { agent } = recording();
    const chat = await openChat(agent);
    await userEvent.type(within(chat).getByRole('textbox', { name: 'Your question' }), 'Is the moon up?{Enter}');
    const checks = await waitFor(() => {
      const c = chat.querySelector('[data-how-sure]');
      if (!c) throw new Error('not yet');
      return c as HTMLElement;
    });
    expect(checks.querySelector('[data-sure]')!.textContent).toBe('High');
    expect(checks.textContent).toContain('Every read worked, the data was read 2 hours ago');
    expect(checks.textContent).toContain('It named no items.');
  });

  it('is Low when a read failed, naming the panel, only for the questions that need it', async () => {
    const failing = fixtureExecute();
    const execute: typeof failing.execute = async (command, input, ...rest) => (command === 'jenkins build list' || command === 'github workflow-run list' ? { ok: false, data: null, error: { code: 'NETWORK', message: 'down', fix: 'retry' }, meta: { command, durationMs: 0, version: 'x', contractVersion: 1 } } : failing.execute(command, input, ...rest)) as never;
    window.location.hash = '#/dossier/card-payments';
    const { agent } = recording();
    render(<App execute={execute} agent={agent} now={FIXTURE_NOW} preview />);
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    await userEvent.click(screen.getByRole('textbox', { name: 'Your question' }));
    const chat = await screen.findByRole('dialog', { name: 'Ask about card-payments' });
    await userEvent.click(within(chat).getByRole('button', { name: /^Who might need help\?/ }));
    await waitFor(() => expect(chat.querySelector('[data-how-sure]')).not.toBeNull());
    // Who might need help needs work, code reviews and owners; builds are not among them.
    expect(chat.querySelector('[data-sure]')!.textContent).not.toBe('Low');
  });

  it('shows a cited id the Toil project does not hold as the bare id, never dropping it', async () => {
    const { agent } = recording((p) => answer(p, { parts: [{ text: '[[corp-jira:PAY-101]] and [[corp-jira:PAY-999]].' }], citations: ['corp-jira:PAY-101', 'corp-jira:PAY-999'], unverified: ['corp-jira:PAY-999'] }));
    const chat = await openChat(agent);
    await userEvent.click(within(chat).getByRole('button', { name: /^What's blocking us\?/ }));
    const looked = await waitFor(() => {
      const l = chat.querySelector('[data-looked-at]');
      if (!l) throw new Error('not yet');
      return l as HTMLElement;
    });
    expect(looked.querySelectorAll('li')).toHaveLength(2);
    expect(within(looked).getAllByRole('link').length).toBe(1);
    expect(looked.querySelector('code.missing')!.textContent).toBe('corp-jira:PAY-999');
  });

  it('is absent on an answer that was stopped or failed', async () => {
    const agent: Agent = { starters: () => [], ask: () => Promise.reject(new Error('down')) };
    const chat = await openChat(agent);
    await userEvent.click(within(chat).getByRole('button', { name: /^What's blocking us\?/ }));
    await within(chat).findByRole('alert');
    expect(chat.querySelector('[data-how-sure]')).toBeNull();
  });
});

describe('with no agent set up', () => {
  const none: Agent = { notice: NO_AGENT_NOTICE, noticeDetails: NO_AGENT_DETAILS, starters: () => [], ask: () => Promise.reject(new Error('none')) };

  it('says in plain words that no AI helper is set up and where an engineer sets one up, with the packages behind a fold', async () => {
    const chat = await openChat(none, 'card-payments', false);
    const notice = chat.querySelector('[data-no-agent]') as HTMLElement;
    const lead = notice.querySelector('p')!.textContent!;
    expect(lead).toBe('No AI helper is set up yet, so nothing can answer questions. An engineer can set one up in Settings → AI helper.');
    expect(lead).not.toMatch(/@|sdk|npm/i);
    const fold = notice.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain('@anthropic-ai/claude-agent-sdk');
    expect(fold.textContent).toContain('@openai/codex-sdk');
    // The questions are still there for a chat that switches to an installed one, and "Before you ask" says nobody answers yet.
    expect(within(chat).getAllByRole('button', { name: /Good for/ }).length).toBe(9);
    expect(within(chat).getByRole('complementary', { name: 'Before you ask' }).textContent).toContain('Nobody yet: no AI helper is set up.');
  });
});

describe('the chat header and usage line (#552)', () => {
  it('names the Toil project in plain words, and in toil\'s own with them off', async () => {
    let chat = await openChat(scriptedAgent());
    expect(chat.querySelector('.ask-strip__context')!.textContent).toContain('Toil project card-payments');
    cleanup();
    setPlain(false);
    chat = await openChat(scriptedAgent());
    expect(chat.querySelector('.ask-strip__context')!.textContent).toContain('Dossier card-payments');
  });

  it('folds to one line under 700px, "Answered by ... · Change", which opens the picker, with the (i) and Close kept', async () => {
    screenWidth(true);
    const chat = await openChat(scriptedAgent());
    const line = chat.querySelector('.ask-strip__context')!;
    expect(line.textContent).toMatch(/^Answered by a scripted preview, not a model · Change/);
    expect(line.textContent).not.toContain('Sprint 42');
    expect(line.textContent).not.toContain('Toil project card-payments');
    expect(within(chat).getByRole('button', { name: 'About these answers' })).toBeTruthy();
    expect(within(chat).getByRole('button', { name: 'Close' })).toBeTruthy();
    await userEvent.click(within(line as HTMLElement).getByRole('button', { name: /^Change/ }));
    expect(await screen.findByRole('heading', { name: 'AI helper for this chat' })).toBeTruthy();
  });

  it('reads one line of usage, with the breakdown behind a fold, keeping a sample label and any cap notice in the open', async () => {
    const chat = await openChat(scriptedAgent());
    await userEvent.click(within(chat).getByRole('button', { name: /^Are we going to finish the sprint\?/ }));
    const footer = await waitFor(() => {
      const f = chat.querySelector('[data-usage-footer]');
      if (!f) throw new Error('not yet');
      return f as HTMLElement;
    });
    const summary = footer.querySelector('summary')!;
    expect(summary.textContent).toMatch(/^Sample figures, not from a model\. about \$0\.\d\d of usage$/);
    const fold = footer.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain('claude-sonnet-4-6');
    expect(chat.querySelector('[data-chat-usage] summary')!.textContent).toMatch(/^Sample figures\. This chat: about \$/);
    expect(chat.querySelector('[data-chat-usage] details, details[data-chat-usage]')!.textContent).toContain('Context of the last answer');
  });
});

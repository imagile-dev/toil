// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { DraftDiagram } from '../src/agent.ts';
import { scriptedAgent } from '../src/fixtures/agent.ts';
import { FoldedCode, DiagramCard } from '../src/components/diagram-card.tsx';
import type { ConfigApi } from '../src/config.ts';
import { DataContext, type Data } from '../src/data.ts';
import { DIAGRAM_SAVED } from '../src/diagram-saved.ts';
import { scriptedJob } from '../src/fixtures/agent.ts';
import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import { jobPrompt } from '../src/model/jobs.ts';
import type { Envelope, Execute } from '../src/toil.ts';
import { loaded } from './harness.ts';

/**
 * The Diagram job's Save card (#582): the press runs `projects diagram save`
 * on the config path with the model the server lifted, says Replace when a
 * diagram is kept, says Saved with a link after, shows a refusal on the card,
 * and, where Toil UI changes nothing (the sample), has no button that would
 * fail. A fenced block in an answer is a folded disclosure.
 */

afterEach(cleanup);

const draft = (): DraftDiagram => scriptedJob(jobPrompt('map-codebase', ''), 'card-payments')!.diagram!;
const meta = { command: 'x', durationMs: 0, version: 't', contractVersion: 1 };
const ok = (data: unknown): Envelope => ({ ok: true, data, error: null, meta }) as unknown as Envelope;
const fail = (code: string, message: string, fix?: string): Envelope => ({ ok: false, data: null, error: { code, message, ...(fix ? { fix } : {}) }, meta }) as unknown as Envelope;

/** A config path that records every call and answers each with `answer`. */
function config(answer: (command: string, input: Record<string, unknown>) => Envelope | Promise<Envelope>, disabled: string | null = null) {
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  const api: ConfigApi = {
    disabled,
    areas: async () => [],
    settings: async () => ({ timeout: { variable: 'TOIL_TIMEOUT_MS', value: null, effectiveMs: 1, defaultMs: 1 } }),
    run: async (command, input) => {
      calls.push({ command, input });
      return answer(command, input);
    },
  };
  return { api, calls };
}

/** The fixture execute() with the stored diagram absent. */
const noDiagram: Execute = (command, input, options) => (command === 'projects diagram show' ? Promise.resolve(fail('NOT_FOUND', 'none')) : fixtureExecute().execute(command, input, options));

async function card(api: ConfigApi, d: DraftDiagram, execute: Execute = fixtureExecute().execute, preview = false) {
  const { data } = await loaded('card-payments');
  const value: Data = { toilProject: data, byId: new Map(), agent: scriptedAgent(), now: FIXTURE_NOW, execute, config: api, ...(preview ? { preview: true } : {}) };
  return render(
    <DataContext value={value}>
      <DiagramCard draft={d} />
    </DataContext>,
  );
}

describe('the Save card', () => {
  it('shows the draft: its title, counts and views, with one press to keep it', async () => {
    await card(config(() => ok({})).api, draft(), noDiagram);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Card payments');
    expect(document.querySelector('[data-diagram-card-counts]')!.textContent).toBe('18 things: 9 observed, 7 inferred, 2 not said');
    expect(screen.getByText(/Views: Card payments in context, Card payments, containers/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Save diagram' })).toBeTruthy();
  });

  it('runs projects diagram save with the model as text and what was left out, and says Saved with a link', async () => {
    const d = draft();
    const saved: string[] = [];
    window.addEventListener(DIAGRAM_SAVED, () => saved.push('fired'));
    const { api, calls } = config(() => ok({ revision: 1 }));
    await card(api, d, noDiagram);
    await userEvent.click(await screen.findByRole('button', { name: 'Save diagram' }));
    await waitFor(() => expect(document.querySelector('[data-diagram-saved]')).not.toBeNull());
    // No replace over a diagram that was not there: toil refuses a surprise one by name.
    expect(calls).toEqual([{ command: 'projects diagram save', input: { toilProject: 'card-payments', text: d.text, notMapped: d.notMapped } }]);
    expect(document.querySelector('[data-diagram-saved]')!.textContent).toContain('Saved, revision 1.');
    expect(screen.getByRole('link', { name: 'Open the diagram' }).getAttribute('href')).toBe('#/project/card-payments/summary/diagram');
    expect(saved).toEqual(['fired']);
    expect(screen.queryByRole('button', { name: /Save diagram|Replace/ })).toBeNull();
  });

  it('says Replace when a diagram is kept, names its revision, and replaces only on that press', async () => {
    const { api, calls } = config(() => ok({ revision: 3 }));
    await card(api, draft());
    const button = await screen.findByRole('button', { name: 'Replace the saved diagram' });
    expect(screen.getByText('Replaces revision 2.')).toBeTruthy();
    await userEvent.click(button);
    await waitFor(() => expect(document.querySelector('[data-diagram-saved]')).not.toBeNull());
    expect(calls[0]!.input).toMatchObject({ toilProject: 'card-payments', replace: true });
    expect(document.querySelector('[data-diagram-saved]')!.textContent).toContain('revision 3');
  });

  it("shows toil's refusal on the card, with its fix, and leaves the press where it was", async () => {
    const { api } = config(() => fail('INVALID_INPUT', 'The model can’t be stored as a diagram: a problem: systems[0].name holds a URL.', 'Remove the address.'));
    await card(api, draft(), noDiagram);
    await userEvent.click(await screen.findByRole('button', { name: 'Save diagram' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('systems[0].name holds a URL.');
    expect(alert.textContent).toContain('Remove the address.');
    expect(screen.getByRole('button', { name: 'Save diagram' })).toBeTruthy();
    expect(document.querySelector('[data-diagram-saved]')).toBeNull();
  });

  it('shows a call that failed outright as the failure it is', async () => {
    const { api } = config(() => Promise.reject(new Error('The server did not answer.')));
    await card(api, draft(), noDiagram);
    await userEvent.click(await screen.findByRole('button', { name: 'Save diagram' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The server did not answer.');
  });

  it('has no button where Toil UI changes nothing, and says why in the words the config path gave, not a claim about samples', async () => {
    const { api, calls } = config(() => ok({}), 'The preview changes nothing.');
    await card(api, draft());
    const off = document.querySelector('[data-diagram-off]')!.textContent!;
    expect(off).toContain('The preview changes nothing.');
    expect(off).not.toContain('Sample data');
    expect(screen.getByRole('link', { name: 'Open the diagram' }).getAttribute('href')).toBe('#/project/card-payments/summary/diagram');
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('with no config path at all says Toil UI cannot change toil’s files, which is true outside the sample too', async () => {
    const { data } = await loaded('card-payments');
    const value: Data = { toilProject: data, byId: new Map(), agent: scriptedAgent(), now: FIXTURE_NOW, execute: fixtureExecute().execute };
    render(
      <DataContext value={value}>
        <DiagramCard draft={draft()} />
      </DataContext>,
    );
    const off = document.querySelector('[data-diagram-off]')!.textContent!;
    expect(off).toContain('This Toil UI cannot change toil’s files.');
    expect(off).not.toContain('Sample data');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no button under `toil-ui --sample` either, where the config path is open and the server would refuse the press', async () => {
    const { api, calls } = config(() => fail('WRITE_DISABLED', 'The preview changes nothing.'), null);
    await card(api, draft(), fixtureExecute().execute, true);
    expect(document.querySelector('[data-diagram-off]')!.textContent).toContain('Sample data: nothing is saved here.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('remembers a saved draft when the pane closes and opens again', async () => {
    const d = draft();
    const { api } = config(() => ok({ revision: 4 }));
    const first = await card(api, d, noDiagram);
    await userEvent.click(await screen.findByRole('button', { name: 'Save diagram' }));
    await waitFor(() => expect(document.querySelector('[data-diagram-saved]')).not.toBeNull());
    first.unmount();
    await card(api, d, noDiagram);
    await act(async () => undefined);
    expect(document.querySelector('[data-diagram-saved]')!.textContent).toContain('revision 4');
  });
});

describe('a fenced block the agent pasted', () => {
  it('is a closed disclosure named for what it is, not a paragraph', () => {
    render(
      <>
        <FoldedCode part={{ text: 'C4Container\n\n  title X', fence: 'mermaid' }} />
        <FoldedCode part={{ text: 'select 1', fence: 'sql' }} />
        <FoldedCode part={{ text: 'whatever', fence: '' }} />
      </>,
    );
    const all = [...document.querySelectorAll<HTMLDetailsElement>('[data-ask-code]')];
    expect(all.map((d) => d.open)).toEqual([false, false, false]);
    expect(all.map((d) => d.querySelector('summary')!.textContent)).toEqual(['Diagram source', 'Code the agent pasted (sql)', 'Code the agent pasted']);
    expect(all[0]!.querySelector('pre')!.textContent).toBe('C4Container\n\n  title X');
  });
});

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { terminalPrompter } from './prompt.js';

/** A fake terminal: what's typed goes in, everything shown is collected. */
function fakeTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

describe('terminalPrompter', () => {
  it('reads a secret without echoing it', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.write('fake-token-abc12345\r');
    expect(await answer).toBe('fake-token-abc12345');
    expect(t.shown()).toContain('token (input hidden): ');
    expect(t.shown()).not.toContain('fake-token-abc12345');
  });

  it('echoes a visible answer, and returns the default for an empty one', async () => {
    const t = fakeTerminal();
    const prompter = terminalPrompter(t.input, t.output);
    const first = prompter.ask('baseUrl', 'https://jira.imagile.dev');
    t.input.write('\r');
    expect(await first).toBe('https://jira.imagile.dev');
    expect(t.shown()).toContain('baseUrl [https://jira.imagile.dev]: ');
    const second = prompter.ask('label');
    t.input.write('reporting\r');
    expect(await second).toBe('reporting');
    expect(t.shown()).toContain('reporting');
  });

  it('turns Ctrl+C into CANCELLED rather than waiting forever', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.write('\u0003');
    await expect(answer).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

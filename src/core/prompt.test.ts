import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BULLET, HiddenLine, terminalPrompter } from './prompt.js';

/** A fake terminal: what's typed goes in, everything shown is collected. */
function fakeTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', (chunk: Buffer) => (shown += chunk.toString()));
  return { input, output, shown: () => shown };
}

const ESC = String.fromCharCode(27);

/** What a terminal would show once escape sequences are taken out. */
const plain = (text: string) => text.replace(new RegExp(`${ESC}\\[[0-9;?]*[@-~]`, 'g'), '');

describe('terminalPrompter', () => {
  it('reads a secret without echoing it, one bullet per character, and returns it untrimmed', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.write('fake-token-abc12345 ');
    t.input.write('\r');
    expect(await answer).toBe('fake-token-abc12345 ');
    expect(t.shown()).toContain(`token (input hidden): \x1b[?2004h${BULLET.repeat(20)}`);
    expect(t.shown()).not.toContain('fake-token');
    // Bracketed paste is turned off again when the line ends.
    expect(t.shown()).toContain('\x1b[?2004l');
  });

  it('redraws the line after Backspace and Ctrl+U, going up a row when the bullets wrapped', async () => {
    const t = fakeTerminal();
    Object.assign(t.output, { columns: 30 });
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    const typed = 'abcdefghijklmnopqrstuvwxyz';
    for (const c of typed) t.input.write(c);
    t.input.write('\x7f');
    t.input.write('\x15');
    t.input.write('xy');
    t.input.write('\b');
    t.input.write('\r');
    expect(await answer).toBe('x');
    const shown = t.shown();
    // "token (input hidden): " is 22 columns, so 26 bullets wrap onto a second row.
    expect(shown).toContain(`\x1b[1A\r\x1b[Jtoken (input hidden): ${BULLET.repeat(25)}`);
    expect(shown).toContain(`\x1b[1A\r\x1b[Jtoken (input hidden): ${BULLET}${BULLET}`);
    expect(shown).toContain(`\r\x1b[Jtoken (input hidden): ${BULLET}\x1b[?2004l`);
    const after = plain(shown).replaceAll('token (input hidden): ', '');
    for (const c of typed) expect(after).not.toContain(c);
  });

  it('shows a multi-line paste as one bullet per character, line breaks included', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.write('\x1b[200~abc\ndef\x1b[201~');
    t.input.write('\r');
    expect(await answer).toBe('abc\ndef');
    expect(plain(t.shown())).toBe(`token (input hidden): ${BULLET.repeat(7)}\r\n`);
  });

  it('notes a line for the person after an answer, and can ask again', () => {
    const t = fakeTerminal();
    const prompter = terminalPrompter(t.input, t.output);
    prompter.note?.('Received 3 characters.');
    expect(t.shown()).toBe('Received 3 characters.\n');
    expect(prompter.canAskAgain).toBe(true);
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

  it('asks a visible question after a hidden one', async () => {
    const t = fakeTerminal();
    const prompter = terminalPrompter(t.input, t.output);
    const secret = prompter.askSecret('token');
    t.input.write('abc');
    t.input.write('\r');
    expect(await secret).toBe('abc');
    const next = prompter.ask('Store it?');
    t.input.write('y\r');
    expect(await next).toBe('y');
  });

  it('writes a question of several lines whole, and prompts on its last line', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).ask('toil would send this:\n{\n  "kind": "bug"\n}\n\nSend it? Type yes to send it', 'no');
    t.input.write('yes\r');
    expect(await answer).toBe('yes');
    expect(t.shown()).toContain('toil would send this:\n{\n  "kind": "bug"\n}\n\n');
    expect(t.shown()).toContain('Send it? Type yes to send it [no]: ');
  });

  it('turns Ctrl+C into CANCELLED rather than waiting forever', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.write('\u0003');
    await expect(answer).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('turns the end of input into CANCELLED', async () => {
    const t = fakeTerminal();
    const answer = terminalPrompter(t.input, t.output).askSecret('token');
    t.input.end();
    await expect(answer).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('HiddenLine', () => {
  const fed = (...chunks: string[]) => {
    const line = new HiddenLine();
    let result: ReturnType<HiddenLine['feed']> = null;
    for (const c of chunks) {
      result = line.feed(c);
      if (result) break;
    }
    return { value: line.value, count: line.count, result };
  };

  it('keeps typed characters, one per code point, and ends on Enter', () => {
    expect(fed('a', 'b', '\u{1F511}', '\r')).toEqual({ value: 'ab\u{1F511}', count: 3, result: 'enter' });
    expect(fed('a', '\n').result).toBe('enter');
    expect(fed('a', '\r\n').result).toBe('enter');
  });

  it('removes one with Backspace (DEL or BS) and clears with Ctrl+U', () => {
    expect(fed('abc', '\x7f', '\b').value).toBe('a');
    expect(fed('abc', '\x15', 'd').value).toBe('d');
    expect(fed('\x7f').value).toBe('');
  });

  it('keeps a pasted line break as text, bracketed or not, for the paste check to report', () => {
    expect(fed('\x1b[200~abc\r\ndef\x1b[201~', '\r')).toEqual({ value: 'abc\r\ndef', count: 8, result: 'enter' });
    expect(fed('\x1b[200~abc\n\x1b[201~', '\r').value).toBe('abc\n');
    // A terminal that doesn't bracket a paste still sends it as one chunk.
    expect(fed('abc\rdef', '\r').value).toBe('abc\rdef');
    expect(fed('abc\r', '\r').value).toBe('abc\r');
  });

  it('takes Enter that arrives in the same chunk as a paste as Enter', () => {
    expect(fed('\x1b[200~abc\ndef\x1b[201~\r')).toEqual({ value: 'abc\ndef', count: 7, result: 'enter' });
  });

  it('handles paste markers split across chunks', () => {
    expect(fed('\x1b[20', '0~ab\ncd\x1b', '[201~', '\r').value).toBe('ab\ncd');
  });

  it('ignores arrows, focus reports and other control keys, and keeps tabs', () => {
    expect(fed('a', '\x1b[A', '\x1b[I', '\x1bOB', '\x01', '\tb', '\r').value).toBe('a\tb');
  });

  it('cancels on Ctrl+C', () => {
    expect(fed('abc', '\x03').result).toBe('cancel');
  });
});

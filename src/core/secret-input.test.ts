import { describe, expect, it } from 'vitest';
import type { Prompter } from './prompt.js';
import { askCheckedSecret, characters, checkSecret, receivedLine } from './secret-input.js';

const TOKEN = 'fake-token-abc12345';
const token = { empty: 'required' } as const;

/** A prompter that answers from a list and records the lines it was told. */
function scripted(answers: string[], canAskAgain: boolean) {
  const notes: string[] = [];
  const asked: Array<{ question: string; id: string | undefined }> = [];
  const prompt: Prompter = {
    ask: async (question, _fallback, id) => {
      asked.push({ question, id });
      return answers.shift() ?? '';
    },
    askSecret: async (question, id) => {
      asked.push({ question, id });
      return answers.shift() ?? '';
    },
    note: (line) => notes.push(line),
    canAskAgain,
  };
  return { prompt, notes, asked };
}

describe('checkSecret', () => {
  it('reports the length only', () => {
    const check = checkSecret(TOKEN, token);
    expect(check).toMatchObject({ status: 'ok', value: TOKEN, length: 19, removed: null, received: 'Received 19 characters.', wrapper: null });
    expect(JSON.stringify({ ...check, value: undefined })).not.toContain('abc');
  });

  it('counts characters as code points', () => {
    expect(characters('a\u{1F511}b')).toBe(3);
    expect(receivedLine(1, null)).toBe('Received 1 character.');
  });

  it.each([
    [`${TOKEN}\n`, 'a trailing newline'],
    [`${TOKEN}\r\n`, 'a trailing newline'],
    [`${TOKEN}\n\n`, '2 trailing newlines'],
    [`  ${TOKEN}`, '2 leading spaces'],
    [`\t${TOKEN}`, 'a leading tab'],
    [` ${TOKEN} \n`, 'a leading space and 2 trailing whitespace characters'],
  ])('trims %j and says it removed %s', (raw, removed) => {
    expect(checkSecret(raw, token)).toMatchObject({ status: 'ok', value: TOKEN, length: 19, removed, received: `Received 19 characters (removed ${removed}).` });
  });

  it.each([
    [`Bearer ${TOKEN}`, '"Bearer "', 'This starts with "Bearer ". Store it without that? [Y/n]'],
    [`bearer  ${TOKEN}`, '"bearer "', 'This starts with "bearer ". Store it without that? [Y/n]'],
    [`token ${TOKEN}`, '"token "', 'This starts with "token ". Store it without that? [Y/n]'],
    [`"${TOKEN}"`, 'the quotes', 'This is in quotes. Store it without them? [Y/n]'],
    [`'${TOKEN}'`, 'the quotes', 'This is in quotes. Store it without them? [Y/n]'],
    [`"Bearer ${TOKEN}"`, 'the quotes and "Bearer "', 'This is in quotes and starts with "Bearer ". Store it without them? [Y/n]'],
  ])('asks about the wrapper on %j', (raw, what, question) => {
    const check = checkSecret(`${raw}\n`, token);
    expect(check).toMatchObject({ status: 'ok', value: raw, wrapper: { without: TOKEN, withoutLength: 19, what, question } });
  });

  it('takes a lone "Bearer" or "token", or quotes with nothing inside, as the value, not a wrapper', () => {
    expect(checkSecret('token', token)).toMatchObject({ status: 'ok', value: 'token', wrapper: null });
    expect(checkSecret('""', token)).toMatchObject({ status: 'ok', value: '""', wrapper: null });
    expect(checkSecret("'x'", token)).toMatchObject({ status: 'ok', wrapper: { without: 'x' } });
  });

  it('refuses a line break in the middle', () => {
    for (const raw of [`${TOKEN}\n${TOKEN}`, `${TOKEN}\r${TOKEN}`, `"${TOKEN}\n${TOKEN}"`]) {
      expect(checkSecret(raw, token)).toMatchObject({ status: 'refused', message: expect.stringContaining('line break in the middle'), fix: 'Copy just the token, on its own, and paste it again.' });
      expect(checkSecret(raw, { password: true, empty: 'required' }).status).toBe('refused');
    }
  });

  it('refuses a space in the middle of a token, but not of a password', () => {
    expect(checkSecret(`${TOKEN} ${TOKEN}`, token)).toMatchObject({ status: 'refused', message: expect.stringContaining('space in the middle') });
    expect(checkSecret(`Bearer ${TOKEN} x`, token).status).toBe('refused');
    expect(checkSecret(`${TOKEN}\t${TOKEN}`, token)).toMatchObject({ status: 'refused', message: expect.stringContaining('a tab in the middle') });
    expect(checkSecret('correct horse battery', { password: true, empty: 'required' })).toMatchObject({ status: 'ok', value: 'correct horse battery' });
    expect(checkSecret('correct\nhorse', { password: true, empty: 'required' })).toMatchObject({ status: 'refused', fix: 'Copy just the password, on its own, and paste it again.' });
  });

  it('says what an empty answer means', () => {
    expect(checkSecret(' \n', { empty: 'required' })).toMatchObject({ status: 'empty', message: 'Nothing was entered, and this one is required.', fix: expect.any(String) });
    expect(checkSecret('', { empty: 'keep' })).toMatchObject({ status: 'empty', message: 'Kept the existing secret.', fix: null });
    expect(checkSecret('', { empty: 'skip' })).toMatchObject({ status: 'empty', message: 'Nothing was entered, so none is stored.' });
  });

  it('never puts the value in a message', () => {
    for (const raw of [`${TOKEN}\n${TOKEN}`, `${TOKEN} x`, `Bearer ${TOKEN}`, `"${TOKEN}"`]) {
      const check = checkSecret(raw, token);
      const words = check.status === 'ok' ? [check.received, check.wrapper?.question, check.wrapper?.what] : [check.message, check.fix];
      expect(words.join(' ')).not.toContain('abc12345');
    }
  });
});

describe('askCheckedSecret', () => {
  it('stores a trimmed value and says what it received', async () => {
    const s = scripted([`${TOKEN}\n`], true);
    expect(await askCheckedSecret(s.prompt, 'token', 'token', token)).toBe(TOKEN);
    expect(s.notes).toEqual(['Received 19 characters (removed a trailing newline).']);
    expect(s.asked).toEqual([{ question: 'token', id: 'secret:token' }]);
  });

  it('asks about a Bearer prefix, and removes it only on yes', async () => {
    const yes = scripted([`Bearer ${TOKEN}`, ''], true);
    expect(await askCheckedSecret(yes.prompt, 'token', 'token', token)).toBe(TOKEN);
    expect(yes.asked[1]).toEqual({ question: 'This starts with "Bearer ". Store it without that? [Y/n]', id: 'unwrap:token' });
    expect(yes.notes).toEqual(['Received 26 characters.', 'Removed "Bearer ": 19 characters left.']);
    const no = scripted([`Bearer ${TOKEN}`, 'n'], true);
    expect(await askCheckedSecret(no.prompt, 'token', 'token', token)).toBe(`Bearer ${TOKEN}`);
    const unsure = scripted([`"${TOKEN}"`, 'maybe', 'y'], true);
    expect(await askCheckedSecret(unsure.prompt, 'token', 'token', token)).toBe(TOKEN);
    expect(unsure.asked).toHaveLength(3);
  });

  it('on a terminal, asks again after a refusal or an empty required answer', async () => {
    const s = scripted([`${TOKEN}\n${TOKEN}`, '', TOKEN], true);
    expect(await askCheckedSecret(s.prompt, 'token', 'token', token)).toBe(TOKEN);
    expect(s.notes).toEqual([
      'This has a line break in the middle, so the paste most likely took two lines. Nothing was stored. Copy just the token, on its own, and paste it again.',
      'Nothing was entered, and this one is required.',
      'Received 19 characters.',
    ]);
  });

  it('keeps or skips on an empty answer, and says so', async () => {
    const kept = scripted([''], true);
    expect(await askCheckedSecret(kept.prompt, 'token', 'token', { empty: 'keep' })).toBe('');
    expect(kept.notes).toEqual(['Kept the existing secret.']);
    expect(await askCheckedSecret(scripted([''], true).prompt, 'token', 'token', { empty: 'skip' })).toBe('');
  });

  it("for a host's person, who answers once, refuses with INVALID_INPUT and the same words", async () => {
    await expect(askCheckedSecret(scripted([`${TOKEN}\n${TOKEN}`], false).prompt, 'token', 'token', token)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'token: This has a line break in the middle, so the paste most likely took two lines. Nothing was stored.',
      fix: 'Copy just the token, on its own, and paste it again.',
    });
    await expect(askCheckedSecret(scripted([''], false).prompt, 'token', 'token', token)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'token: Nothing was entered, and this one is required. Nothing was saved.' });
    await expect(askCheckedSecret(scripted([`"${TOKEN}"`, 'maybe'], false).prompt, 'token', 'token', token)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

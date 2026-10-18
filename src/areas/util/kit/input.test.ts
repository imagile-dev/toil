import { describe, expect, it } from 'vitest';
import { memoryFiles } from '../../../../test/harness/files.js';
import type { Warning } from '../../../core/envelope.js';
import { DEFAULT_MAX_LINE, inputFields, openInput, type InputLine, type ReadOptions } from './input.js';

const setup = (files: Record<string, string | Uint8Array> = {}, stdin?: string) => {
  const warnings: Warning[] = [];
  const ctx = { files: memoryFiles(files, stdin === undefined ? {} : { stdin }), warn: (w: Warning) => warnings.push(w) };
  return { ctx, warnings, open: (fields: { file?: string; text?: string }, options?: ReadOptions) => openInput(ctx, fields, options) };
};

/** Files whose streams come in chunks of `chunkSize`, to put chunk boundaries anywhere. */
const chunked = (files: Record<string, string | Uint8Array>, chunkSize: number) => {
  const memory = memoryFiles(files);
  const stream = memory.readStream.bind(memory);
  memory.readStream = (path, o) => stream(path, { ...o, chunkSize });
  return memory;
};

const all = async (lines: AsyncIterable<InputLine>) => {
  const out: InputLine[] = [];
  for await (const line of lines) out.push(line);
  return out;
};

describe('openInput', () => {
  it('reads a file, stdin or text, and names each in its label', async () => {
    const { open } = setup({ 'a.txt': 'from file' }, 'from stdin');
    const file = await open({ file: 'a.txt' });
    expect([await file.text(), file.label, file.expectedBytes]).toEqual(['from file', 'the file "a.txt"', 9]);
    const stdin = await open({});
    expect([await stdin.text(), stdin.label, stdin.expectedBytes]).toEqual(['from stdin', 'stdin', undefined]);
    expect(await (await open({ file: '-' })).text()).toBe('from stdin');
    const text = await open({ text: 'inline' });
    expect([await text.text(), text.label, text.expectedBytes]).toEqual(['inline', 'the text', 6]);
  });

  it('refuses file and text together, a missing file, and over MCP with neither says to pass one', async () => {
    const { open } = setup({ 'a.txt': 'x' });
    await expect(open({ file: 'a.txt', text: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Pass a file or text, not both.' });
    await expect(open({})).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('pass file or text') });
    await expect(open({ file: 'missing.txt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('streams lines with numbers, dropping LF and CRLF endings, across any chunk boundary', async () => {
    const content = 'first\r\nsecond\n\nfourth: é\r\nlast';
    const expected = [
      { number: 1, text: 'first' },
      { number: 2, text: 'second' },
      { number: 3, text: '' },
      { number: 4, text: 'fourth: é' },
      { number: 5, text: 'last' },
    ];
    for (const chunkSize of [1, 2, 3, 7, 1024]) {
      const input = await openInput({ files: chunked({ 'a.log': content }, chunkSize), warn: () => {} }, { file: 'a.log' });
      expect(await all(input.lines()), `chunk ${chunkSize}`).toEqual(expected);
      expect(input.bytesRead).toBe(Buffer.byteLength(content));
    }
    const { open } = setup();
    expect(await all((await open({ text: 'a\nb\n' })).lines())).toEqual([
      { number: 1, text: 'a' },
      { number: 2, text: 'b' },
    ]);
    expect(await all((await open({ text: '' })).lines())).toEqual([]);
  });

  it('cuts a line past the longest kept and marks it, keeping memory bounded', async () => {
    const { open } = setup();
    const lines = await all((await open({ text: `${'x'.repeat(DEFAULT_MAX_LINE + 10)}\nshort` })).lines());
    expect(lines[0]).toMatchObject({ number: 1, cut: true });
    expect(lines[0]!.text).toHaveLength(DEFAULT_MAX_LINE);
    expect(lines[1]).toEqual({ number: 2, text: 'short' });
  });

  it('re-reads chosen lines, so a command can check a line number it reports', async () => {
    const { open } = setup({ 'a.log': 'one\ntwo\nthree\nfour' });
    const input = await open({ file: 'a.log' });
    expect(await input.linesAt([3, 1, 9])).toEqual(
      new Map([
        [1, 'one'],
        [3, 'three'],
      ]),
    );
  });

  it('refuses binary content unless the command takes bytes', async () => {
    const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const { open } = setup({ 'a.png': bin });
    await expect((await open({ file: 'a.png' })).text()).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'The file "a.png" looks binary: it has a NUL byte at offset 4.' });
    expect([...(await (await open({ file: 'a.png' }, { binary: 'allow' })).bytes())]).toEqual([...bin]);
  });

  it('warns once when the bytes are not valid UTF-8, and not for a character split across chunks', async () => {
    const { open, warnings } = setup({ 'bad.txt': new Uint8Array([0x61, 0xff, 0x62, 0x0a, 0x63, 0xfe]) });
    const lines = await all((await open({ file: 'bad.txt' })).lines());
    expect(lines.map((l) => l.text)).toEqual(['a\ufffdb', 'c\ufffd']);
    expect(warnings).toEqual([{ code: 'INPUT_NOT_UTF8', message: 'The file "bad.txt" isn\'t valid UTF-8; the bytes that aren\'t are shown as U+FFFD.' }]);
    const quiet: Warning[] = [];
    const ok = await openInput({ files: chunked({ 'ok.txt': 'aé€😀' }, 2), warn: (w) => quiet.push(w) }, { file: 'ok.txt' });
    expect(await ok.text()).toBe('aé€😀');
    expect([ok.invalidUtf8, quiet]).toEqual([false, []]);
  });

  it('holds to the cap: a whole read refuses, a stream stops and says so', async () => {
    const { open, warnings } = setup({ 'big.log': 'a\nb\nc\nd\n' }, 'more than ten bytes of stdin');
    await expect((await open({ file: 'big.log' }, { maxBytes: 4 })).text()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'The file "big.log" is 8 bytes, more than the 4 bytes this command reads.',
    });
    const streamed = await open({ file: 'big.log' }, { maxBytes: 4 });
    expect((await all(streamed.lines())).map((l) => l.text)).toEqual(['a', 'b']);
    expect(streamed.truncated).toBe(true);
    expect(warnings).toEqual([{ code: 'INPUT_TRUNCATED', message: 'Only the first 4 bytes of the file "big.log" were read; the rest was left out.' }]);
    await expect(open({}, { maxBytes: 10 })).rejects.toMatchObject({ message: 'Stdin is more than the 10 bytes this command reads.' });
  });

  it('declares the fields every reading command shares', () => {
    expect(Object.keys(inputFields)).toEqual(['file', 'text']);
  });
});

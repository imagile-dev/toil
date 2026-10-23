import type { Background } from './themes/index.js';

/**
 * Whether the terminal's background is light or dark, so a theme's colours
 * stay readable on it (#427). Asked once, before the splash: COLORFGBG when
 * the terminal sets it (rxvt, Konsole, iTerm2 and others, or a person who sets
 * it by hand), else the terminal itself, with the xterm query for its
 * background colour (OSC 11). A terminal that doesn't answer is taken to be
 * dark, the common case and the one toil's own palette was drawn for. No
 * terminal was asked to fill in a questionnaire; it gets one question.
 */

/** COLORFGBG is "fg;bg" (or "fg;default;bg"): ANSI colours 0 to 6 and 8 are dark, 7 and 9 to 15 light. */
export function backgroundFromEnv(env: NodeJS.ProcessEnv): Background | undefined {
  const last = env.COLORFGBG?.split(';').pop()?.trim();
  if (!last || !/^\d+$/.test(last)) return undefined;
  const n = Number(last);
  if (n > 15) return undefined;
  return n === 7 || n >= 9 ? 'light' : 'dark';
}

/** The background from a terminal's reply to OSC 11: `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` (1 to 4 hex digits a channel). */
export function parseBackgroundReply(text: string): Background | undefined {
  const m = /\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(text);
  if (!m) return undefined;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16) / (16 ** h.length - 1)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
}

/** The answer to the device-attributes query (DA1), which every VT terminal sends: once it's in, nothing more is coming. */
const DA1_REPLY = /\x1b\[\?[\d;]*c/; // eslint-disable-line no-control-regex

export interface ProbeIO {
  input: Pick<NodeJS.ReadStream, 'on' | 'off'>;
  write: (text: string) => void;
}

/** What the probe learned: the background, if the terminal said, and whether its answer came in before the wait ended. */
export interface Probe {
  background?: Background;
  /** The DA1 answer arrived in time, so nothing more is on its way. */
  answered: boolean;
}

/**
 * Asks the terminal for its background, with DA1 after it so a terminal that
 * ignores OSC 11 still ends the wait at once by answering the second. Gives up
 * after `timeoutMs`. Run in raw mode before any keypress listener, so the
 * reply is read here and never taken for keys; an answer that arrives after
 * the wait is for `lateReplyFilter()` to drop.
 */
export function probeBackground(io: ProbeIO, timeoutMs = 500): Promise<Probe> {
  return new Promise((resolve) => {
    let got = '';
    const done = (answered: boolean) => {
      clearTimeout(timer);
      io.input.off('data', onData);
      const background = parseBackgroundReply(got);
      resolve({ ...(background ? { background } : {}), answered });
    };
    const onData = (chunk: Buffer | string) => {
      got += chunk.toString();
      if (DA1_REPLY.test(got)) done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    io.input.on('data', onData);
    io.write('\x1b]11;?\x1b\\\x1b[c');
  });
}

/** The most keys one OSC 11 answer can come as: `ESC ] 11;rgb:rrrr/gggg/bbbb ESC \`, with room to spare. */
const OSC_KEYS = 40;
/** The most keys the DA1 answer can come as after its `ESC [ ?`. */
const DA1_KEYS = 24;

/**
 * For a probe the terminal answered too late (a slow SSH link): a filter that
 * drops, as keys, the answer still on its way, so `]11;rgb:` never reaches the
 * menu, where a 1 would choose a row. Node's readline hands the answer over as
 * `ESC ]`, then one key a character up to `ESC \` or BEL, then `ESC [ ?`, the
 * digits and a `c`. The filter drops the OSC answer from its `ESC ]` to its
 * terminator (40 keys at most) and the DA1 answer to its `c`, which comes last
 * and disarms it. Every other key passes.
 */
export function lateReplyFilter(): (sequence: string | undefined) => boolean {
  let osc = 0;
  let da = 0;
  let armed = true;
  return (sequence) => {
    if (!armed || sequence === undefined) return false;
    if (osc > 0) {
      osc = sequence === '\x1b\\' || sequence === '\x07' ? 0 : osc - 1;
      return true;
    }
    if (da > 0) {
      da = sequence === 'c' ? 0 : da - 1;
      if (da === 0) armed = false;
      return true;
    }
    if (sequence.startsWith('\x1b]')) {
      osc = OSC_KEYS;
      return true;
    }
    if (sequence === '\x1b[?') {
      da = DA1_KEYS;
      return true;
    }
    return false;
  };
}

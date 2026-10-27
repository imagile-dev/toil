import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_VERSION, readConfigForEdit, writeConfigFile } from '../../core/config.js';
import { freshProgress, parseProgress, type Progress } from './perks.js';
import type { SaveIO } from './play.js';

/**
 * Two Weeks' Notice keeps its progress in the user's own config file, under
 * `"game"`, sealed with AES-256-GCM. The key is derived from the account and
 * home folder, so a save can't be edited by hand or copied to someone else's
 * machine and still load. That is tamper-evidence, not secrecy: anyone who can
 * read your files and this source can open it. The same is true of every
 * performance review.
 *
 * Nothing here throws into the game. A save that can't be read or written
 * becomes a notice on screen, and the run goes on.
 */

/** The config key. Reserved in src/core/config.ts so it never reads as an area. */
export const SAVE_KEY = 'game';
const PREFIX = 'twn1.';

export interface Who {
  /** The account name and home folder the key is derived from. */
  user: string;
  home: string;
}

const keys = new Map<string, Buffer>();
/** The sealing key for an account, derived once per process: scrypt is slow on purpose, and saves are frequent. */
function keyFor(who: Who): Buffer {
  const id = `toil:two-weeks-notice:${who.user}:${who.home}`;
  let key = keys.get(id);
  if (!key) keys.set(id, (key = scryptSync(id, 'toil-two-weeks-notice-v1', 32)));
  return key;
}

const IV = 12;
const TAG = 16;

export function seal(p: Progress, who: Who): string {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', keyFor(who), iv, { authTagLength: TAG });
  const body = Buffer.concat([cipher.update(JSON.stringify(p), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The progress inside a sealed save, or undefined when it was altered, belongs to someone else, or isn't one. */
export function unseal(sealed: string, who: Who): Progress | undefined {
  if (!sealed.startsWith(PREFIX)) return undefined;
  try {
    const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64url');
    // A full-length tag only: a trimmed save must fail, not open with a weaker check.
    if (raw.length <= IV + TAG) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(who), raw.subarray(0, IV), { authTagLength: TAG });
    decipher.setAuthTag(raw.subarray(IV, IV + TAG));
    const text = Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]).toString('utf8');
    return parseProgress(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export interface Loaded {
  progress: Progress;
  /** Why the save wasn't used, or why it won't be kept; shown on the lobby. */
  notice?: string;
  /** False when saving would mean rewriting a file toil shouldn't touch for a game. */
  writable: boolean;
}

function readRaw(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export function loadProgress(path: string, who: Who): Loaded {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = readRaw(path);
  } catch (err) {
    return { progress: freshProgress(), writable: false, notice: `Progress isn't being saved: ${path} couldn't be read (${err instanceof Error ? err.message : String(err)}).` };
  }
  const version = raw ? (raw.version ?? 1) : CONFIG_VERSION;
  if (typeof version === 'number' && version > CONFIG_VERSION) {
    return { progress: freshProgress(), writable: false, notice: `Progress isn't being saved: ${path} was written by a newer toil, and this one won't rewrite it.` };
  }
  if (version !== CONFIG_VERSION) {
    const notice = `Progress isn't being saved: ${path} is an older config file, and toil won't rewrite it just to keep a game. Any toil command that saves a connection upgrades it.`;
    // A version 2 file's "game" key reads the same, so an existing save still loads; it is read from the raw JSON, never migrated, and never written back.
    const kept = version === 2 && typeof raw?.[SAVE_KEY] === 'string' ? unseal(raw[SAVE_KEY] as string, who) : undefined;
    return { progress: kept ?? freshProgress(), writable: false, notice };
  }
  const sealed = raw?.[SAVE_KEY];
  if (sealed === undefined) return { progress: freshProgress(), writable: true };
  const progress = typeof sealed === 'string' ? unseal(sealed, who) : undefined;
  if (progress) return { progress, writable: true };
  return {
    progress: freshProgress(),
    writable: true,
    notice: 'Your saved progress could not be read: it was edited by hand, or came from another account. You are starting over, and the next save replaces it.',
  };
}

/**
 * Saves progress into the config file, keeping every other key as it was.
 * Without a config file it creates one holding only the save, as a first
 * `toil connections add` would create one holding only that connection.
 * Returns why it couldn't, or undefined.
 */
export function storeProgress(path: string, p: Progress, who: Who): string | undefined {
  try {
    const config = readConfigForEdit(path);
    writeConfigFile(path, { ...config, [SAVE_KEY]: seal(p, who) });
    return undefined;
  } catch (err) {
    return `Progress couldn't be saved to ${path}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Loading and saving bound to one config file and account, as the game's loop takes them. */
export const saveFor = (path: string, who: Who): SaveIO => ({ load: () => loadProgress(path, who), store: (p) => storeProgress(path, p, who) });

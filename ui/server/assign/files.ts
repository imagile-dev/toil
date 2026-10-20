/**
 * Where assignments live on disk (#293), and their settings. Each
 * assignment, transcript and all, is one JSON file under the cache,
 * `<data folder>/cache/assignments/<id>.json`, owner-only and written
 * through a temporary file, so `toil-ui wipe` takes them with everything
 * else a sync brought in: they quote tracker text. The settings (how many
 * run at once, how long each may take) are `<data folder>/assignments.json`,
 * beside agent.json and usage.json, so a wipe keeps the limits. A filing
 * cabinet in the basement, and the key on the hook by the door.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIGNMENT_ID, DEFAULT_ASSIGN_SETTINGS, type AssignmentRecord, type AssignSettings } from '../../src/assign/model.ts';
import { AssignError, type Keeper } from '../../src/assign/queue.ts';

export const assignmentsDir = (dataDir: string) => join(dataDir, 'cache', 'assignments');
export const assignSettingsFile = (dataDir: string) => join(dataDir, 'assignments.json');

/** The most assignments that may run at once, and the longest a time limit may be (Bounds): each run starts a CLI. */
export const MAX_CONCURRENT = 3;
export const MAX_TIME_LIMIT_MINUTES = 240;

const write = (file: string, value: unknown) => {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
};

/**
 * The records on disk. A file that doesn't parse is skipped and reported
 * through `problems`, so one bad file never hides the rest.
 */
export function fileKeeper(dataDir: string, problems: string[] = []): Keeper {
  const dir = assignmentsDir(dataDir);
  return {
    load() {
      let names: string[];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith('.json'));
      } catch {
        return [];
      }
      const out: AssignmentRecord[] = [];
      for (const name of names) {
        try {
          const r = JSON.parse(readFileSync(join(dir, name), 'utf8')) as AssignmentRecord;
          if (ASSIGNMENT_ID.test(r.id) && `${r.id}.json` === name) out.push(r);
          else problems.push(`${join(dir, name)} isn't an assignment Toil UI wrote, so it was left alone.`);
        } catch (e) {
          problems.push(`${join(dir, name)} couldn't be read (${(e as Error).message}), so it was left alone.`);
        }
      }
      return out;
    },
    save(record) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      write(join(dir, `${record.id}.json`), record);
    },
  };
}

/** A keeper in memory: the sample's and the tests'. */
export function memoryKeeper(seed: AssignmentRecord[] = []): Keeper & { saved: Map<string, AssignmentRecord> } {
  const saved = new Map(seed.map((r) => [r.id, structuredClone(r)]));
  return { saved, load: () => [...saved.values()].map((r) => structuredClone(r)), save: (r) => void saved.set(r.id, structuredClone(r)) };
}

/** Checks assignment settings from the page or the file; anything that doesn't fit is refused, naming the setting. */
export function checkAssignSettings(input: unknown): AssignSettings {
  const shape = `Send { "concurrent": 1, "timeLimitMinutes": 20 }: 1 to ${MAX_CONCURRENT} at once, and 1 to ${MAX_TIME_LIMIT_MINUTES} minutes each.`;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AssignError('The assignment settings must be an object.', shape);
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== 'concurrent' && k !== 'timeLimitMinutes');
  if (extra.length) throw new AssignError(`The assignment settings have no ${extra.map((k) => JSON.stringify(k)).join(', ')}.`, shape);
  const whole = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;
  if (!whole(o.concurrent, MAX_CONCURRENT)) throw new AssignError(`concurrent is how many assignments run at once, a whole number from 1 to ${MAX_CONCURRENT}.`, shape);
  if (!whole(o.timeLimitMinutes, MAX_TIME_LIMIT_MINUTES)) throw new AssignError(`timeLimitMinutes is how long one assignment may run, a whole number of minutes from 1 to ${MAX_TIME_LIMIT_MINUTES}.`, shape);
  return { concurrent: o.concurrent as number, timeLimitMinutes: o.timeLimitMinutes as number };
}

/**
 * The saved settings, or the defaults (one at a time, 20 minutes) when there
 * is no file. A broken file throws, so assignments never run on a limit
 * nobody set.
 */
export function loadAssignSettings(dataDir: string): AssignSettings {
  const file = assignSettingsFile(dataDir);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_ASSIGN_SETTINGS };
    throw new AssignError(`Toil UI couldn't read ${file}: ${(e as Error).message}`, "Check the file's permissions; assignments won't start until their limits can be read.");
  }
  try {
    return checkAssignSettings(JSON.parse(text));
  } catch (e) {
    const why = e instanceof AssignError ? e.message : "it isn't JSON";
    throw new AssignError(`${file}: ${why}`, 'Save the limits again in the Agents lane, which rewrites it, or delete the file for one at a time and 20 minutes each.');
  }
}

/** The settings the queue runs on: the saved ones, or none at all (concurrent 0, saying why) when the file is broken. */
export function queueSettings(dataDir: string): AssignSettings {
  try {
    return loadAssignSettings(dataDir);
  } catch (e) {
    return { ...DEFAULT_ASSIGN_SETTINGS, concurrent: 0, problem: e instanceof AssignError ? `${e.message} ${e.fix}` : String(e) };
  }
}

export function saveAssignSettings(dataDir: string, settings: AssignSettings) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  write(assignSettingsFile(dataDir), checkAssignSettings(settings));
}

// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute as toil, registry } from '@imagile-dev/toil/api';
import { Validator } from '@cfworker/json-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classificationReader } from '../server/agents/tools.ts';
import { insightsBase } from '../src/insights-input.ts';
import type { Envelope, Execute } from '../src/toil.ts';

/**
 * The agent reads the scheme the way the Classify page does (#566): by toil project and folder, so a scheme kept beside the
 * toil project file is found, and when it can't be read the tool result says so rather than quoting the default scheme as if
 * it were the person's own.
 */

const execute = toil as unknown as Execute;
let home = '';

const category = (id: string) => ({ id, short: id.toUpperCase(), name: id, label: id, definition: `The ${id} work.` });

beforeEach(() => {
  home = realpathSync.native(mkdtempSync(join(tmpdir(), 'toil-ui-agent-classify-')));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  mkdirSync(join(home, '.toil', 'projects'), { recursive: true });
  writeFileSync(join(home, '.toil', 'projects', 'beside.json'), JSON.stringify({ name: 'beside', classify: { scheme: './beside-scheme.json' } }));
  writeFileSync(join(home, '.toil', 'projects', 'beside-scheme.json'), JSON.stringify({ name: 'beside-scheme', revision: 1, categories: [category('alpha'), category('beta')] }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("the agent's classification read", () => {
  it('finds a scheme kept beside the toil project file', async () => {
    const read = await classificationReader(execute, 'beside', home)();
    expect(read.note).toBeUndefined();
    expect(read.scheme?.name).toBe('beside-scheme');
    expect(insightsBase([], [], null, read).scheme?.categories.map((c) => c.id)).toEqual(['alpha', 'beta']);
  });

  it('says the categories could not be read when toil refuses, never an empty map standing in for none', async () => {
    const refuse: Execute = async (command) => ({ ok: false, data: null, error: { code: 'NOT_FOUND', message: `${command} failed here`, fix: 'x' }, meta: { command, durationMs: 0, version: 't', contractVersion: 1 } }) as Envelope;
    const read = await classificationReader(refuse, 'beside', home)();
    expect(read.note).toContain('The categories could not be read');
    expect(read.note).toContain('classify stats failed here');
    expect(insightsBase([], [], null, read).schemeNote).toContain('could not be read');
    // A read that works carries no note.
    expect(insightsBase([], [], null, await classificationReader(execute, 'beside', home)()).schemeNote).toBeNull();
  });

  it('asks only with read-only commands and input their schemas accept', () => {
    const byName = new Map(registry.commands.map((c) => [c.name, c]));
    for (const [command, input] of [['classify stats', { toilProject: 'beside', standing: true, cwd: home }], ['classify scheme show', { toilProject: 'beside', cwd: home }]] as const) {
      const def = byName.get(command)!;
      expect(def.writes || def.writesLocal || def.writesDependOnInput, command).toBe(false);
      expect(new Validator(def.inputSchema as object, '2020-12', false).validate(input).errors, command).toEqual([]);
    }
  });
});

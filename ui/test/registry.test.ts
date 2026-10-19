import { Validator } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';
import { execute, mapOwi as apiMapOwi, registry } from '../../src/api.ts';
import { CANNED, callKey, fixtureExecute } from '../src/fixtures/execute.ts';
import { loadDossier, loadDossiers } from '../src/load.ts';
import { mapOwi } from '../src/owi.ts';
import type { Execute } from '../src/toil.ts';
import { NAMES } from './harness.ts';

/**
 * The fixture `execute()` against toil's real registry, imported from source
 * (src/api.ts), so renaming a command or a flag the preview uses fails here.
 * Every canned call must name a command `execute()` serves, one that only
 * reads, with input that validates against that command's own strict JSON
 * Schema. This file is type-checked with tsconfig.registry.json, which can
 * load the CLI's Node-only sources; the main tsconfig leaves it out.
 */

// The fixture's signature is the API's, both ways: either can stand in for the other.
const asApi: typeof execute = fixtureExecute().execute;
const asUi: Execute = execute;
void asApi;
void asUi;

const byName = new Map(registry.commands.map((c) => [c.name, c]));

describe.each(CANNED.map((c) => [`${c.command} ${JSON.stringify(c.input)}`, c] as const))('%s', (_label, call) => {
  const def = byName.get(call.command);

  it('is a command execute() serves', () => {
    expect(def, `toil has no API command "${call.command}"`).toBeDefined();
  });

  it('only reads, whatever its input', () => {
    expect(def!.writes).toBe(false);
    expect(def!.writesLocal).toBe(false);
    expect(def!.writesDependOnInput).toBe(false);
  });

  it("validates against the command's input schema", () => {
    const result = new Validator(def!.inputSchema as object, '2020-12', false).validate(call.input);
    expect(result.errors.map((e) => `${e.instanceLocation} ${e.error}`)).toEqual([]);
  });
});

describe('the dashboards', () => {
  it('ask only for calls the fixture answers, all read-only, and ask for every one', async () => {
    const fixture = fixtureExecute();
    const options = new Set<string>();
    const watched: Execute = (command, input, opts) => {
      options.add(JSON.stringify(opts));
      return fixture.execute(command, input, opts);
    };
    await loadDossiers(watched);
    for (const name of NAMES) await loadDossier(watched, name);
    expect(fixture.calls.filter((c) => !c.ok)).toEqual([]);
    expect([...options]).toEqual([JSON.stringify({ readOnly: true, caller: 'toil-ui' })]);
    const asked = new Set(fixture.calls.map((c) => callKey(c.command, c.input)));
    for (const c of CANNED) expect(asked.has(callKey(c.command, c.input)), `${c.command} ${JSON.stringify(c.input)} is never asked for`).toBe(true);
  });
});

describe("the browser's mapOwi", () => {
  it.each(NAMES)("maps %s's work exactly as the API's mapOwi does", async (name) => {
    const browser = await loadDossier(fixtureExecute().execute, name, { mapOwi });
    const api = await loadDossier(fixtureExecute().execute, name, { mapOwi: (input) => apiMapOwi(input) });
    expect(browser.items.length).toBeGreaterThan(0);
    expect(browser.items).toEqual(api.items);
  });
});

describe('every proposal the board and the scripted agent can make', async () => {
  const { COLUMNS, proposeMove } = await import('../src/model/board.ts');
  const { SCRIPTS } = await import('../src/fixtures/agent.ts');
  const proposals = [];
  for (const name of NAMES) {
    const { items } = await loadDossier(fixtureExecute().execute, name);
    for (const item of items) for (const to of COLUMNS) proposals.push(proposeMove(item, to, items, name));
  }
  for (const scripts of Object.values(SCRIPTS)) for (const s of Object.values(scripts)) proposals.push(...(s.proposals ?? []));
  const withCommand = proposals.filter((p) => p?.command);

  it('includes some of each kind', () => {
    expect(new Set(withCommand.map((p) => p!.command))).toEqual(new Set(['jira transition-issue', 'ado work transition', 'jira update-issue', 'ado work update']));
  });

  it.each(withCommand.map((p) => [p!.id, p!] as const))('%s names a write command, with input its schema accepts', (_id, p) => {
    const def = byName.get(p.command!);
    expect(def, `toil has no API command "${p.command}"`).toBeDefined();
    expect(def!.writes).toBe(true);
    const result = new Validator(def!.inputSchema as object, '2020-12', false).validate(p.input);
    expect(result.errors.map((e) => `${e.instanceLocation} ${e.error}`)).toEqual([]);
  });
});

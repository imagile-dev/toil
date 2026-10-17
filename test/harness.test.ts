import { describe, expect, it } from 'vitest';
import { connectionsCommands } from '../src/connections/commands.js';
import { execute } from '../src/core/run.js';
import { scriptedPrompter, testContext } from './harness/context.js';
import { fakeStore } from './harness/fake-store.js';
import { loadFixtures, setUp, tearDown, writeOperations, type LoadedFixture } from './harness/fixtures.js';
import { recordOperations, traceOperations } from './harness/operations.js';

/**
 * The parity suite trusts these helpers to see differences between the two
 * front doors. These tests make sure they would: a log that records nothing,
 * or records every call in one shared list, would let the suite pass on
 * anything. Auditing the auditors is, for once, in scope.
 */
describe('operations log', () => {
  const worker = {
    async read(id: string, call: { signal: AbortSignal; debug: () => void }) {
      return { id, aborted: call.signal.aborted };
    },
    async write(id: string) {
      return id;
    },
  };
  traceOperations(worker, 'worker');
  traceOperations(worker, 'worker');

  it('logs each traced call once, with comparable arguments and no signals or functions', async () => {
    const { result, operations } = await recordOperations(() => worker.read('a', { signal: new AbortController().signal, debug: () => {} }));
    expect(result).toEqual({ id: 'a', aborted: false });
    expect(operations).toEqual([{ op: 'worker.read', args: ['a', {}] }]);
  });

  it('keeps concurrent runs apart, so the CLI run and the MCP run each get their own log', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const [one, two] = await Promise.all([
      recordOperations(async () => {
        await tick();
        await worker.write('one');
      }),
      recordOperations(async () => {
        await worker.write('two');
        await tick();
        await worker.write('two again');
      }),
    ]);
    expect(one.operations.map((o) => o.args[0])).toEqual(['one']);
    expect(two.operations.map((o) => o.args[0])).toEqual(['two', 'two again']);
    // Two doors that made different calls are told apart.
    expect(one.operations).not.toEqual(two.operations);
  });

  it('lets calls outside a recording through untouched', async () => {
    expect(await worker.write('quiet')).toBe('quiet');
  });
});

describe('fixture setup and teardown', () => {
  const base = { routes: [], config: {}, files: {}, commands: [], trace: [] };

  it('replaces config, files and routes with what setup returns, starts tracing, and tears down', async () => {
    const target = { async go() {} };
    let tornDown = false;
    const f: LoadedFixture = {
      ...base,
      area: 'x',
      trace: [{ label: 't', target, writes: ['go'] }],
      setup: () => ({ config: { x: { token: 'made' } }, files: { 'a.txt': 'a' } }),
      teardown: () => {
        tornDown = true;
      },
    };
    await setUp([f]);
    expect(f.config).toEqual({ x: { token: 'made' } });
    expect(f.files).toEqual({ 'a.txt': 'a' });
    expect((await recordOperations(() => target.go())).operations.map((o) => o.op)).toEqual(['t.go']);
    expect([...writeOperations(f)]).toEqual(['t.go']);
    await tearDown([f]);
    expect(tornDown).toBe(true);
  });

  it('runs every teardown even when one throws', async () => {
    let second = false;
    const failing: LoadedFixture = {
      ...base,
      area: 'a',
      teardown: () => {
        throw new Error('boom');
      },
    };
    const fine: LoadedFixture = {
      ...base,
      area: 'b',
      teardown: () => {
        second = true;
      },
    };
    await expect(tearDown([failing, fine])).rejects.toThrow(/teardown failed/);
    expect(second).toBe(true);
  });

  it('importing a fixture has no side effects: the db file is made by setup, not on load', async () => {
    const db = (await loadFixtures()).find((f) => f.area === 'db')!;
    expect(db.config).toEqual({});
    expect(db.setup).toBeTypeOf('function');
  });
});

describe('testContext with a credential store and a prompter', () => {
  it('hands both to a command that manages connections', async () => {
    const store = fakeStore();
    const { prompt, asked } = scriptedPrompter({ Area: 'demo' });
    const add = connectionsCommands([]).find((c) => c.path.join(' ') === 'connections add')!;
    const { context } = testContext({ secrets: store, prompt });
    expect(context.secrets).toBe(store);
    expect(context.prompt).toBe(prompt);
    // No area is registered here, so add refuses the answer; the point is that it asked.
    await execute(add, { name: 'corp-demo' }, context);
    expect(asked.length).toBeGreaterThan(0);
  });

  it('leaves both out by default, as under MCP', () => {
    const { context } = testContext();
    expect(context.secrets).toBeUndefined();
    expect(context.prompt).toBeUndefined();
  });

  it('a scripted prompter answers by prefix, falls back, and records hidden reads', async () => {
    const { prompt, asked } = scriptedPrompter({ Token: 'not-a-real-token' });
    expect(await prompt.askSecret('Token for corp-demo: ')).toBe('not-a-real-token');
    expect(await prompt.ask('Port', '5432')).toBe('5432');
    expect(asked).toEqual([
      { question: 'Token for corp-demo: ', hidden: true },
      { question: 'Port', hidden: false },
    ]);
  });
});

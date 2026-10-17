import { describe, expect, it } from 'vitest';
import { testContext } from '../../../test/harness/context.js';
import type { Route } from '../../../test/harness/fake-fetch.js';
import { runCli } from '../../../test/harness/cli.js';
import { API, changeRequest, changeRequestList, config, definition, ENV, environments, flagsPage, SPLIT, storedChangeRequest, workspace, workspacesPage, WS } from '../../../test/fixtures/splitio.fixture.js';
import type { AnyCommand } from '../../core/command.js';
import { execute } from '../../core/run.js';
import { changeRequestsGetCommand, changeRequestsListCommand } from './change-requests.js';
import { environmentsListCommand } from './environments.js';
import {
  flagsArchiveCommand,
  flagsBatchToggleCommand,
  flagsGetCommand,
  flagsKillCommand,
  flagsListCommand,
  flagsRestoreCommand,
  flagsSetDefaultCommand,
  flagsSetRuleCommand,
  flagsToggleCommand,
  flagsUpdateCommand,
} from './flags.js';
import { workspacesListCommand } from './workspaces.js';
import { commands } from './index.js';

/**
 * Request building and response reshaping, command by command, against the
 * Admin API as Split's reference documents it (the fixture says which page
 * each shape came from). #79's items are settled here: the fixed ones assert
 * the documented request, and the two kept as suspected bugs say so. The
 * paperwork is filed; whether anyone reads it is a matter for the approvers.
 */

const AUTH = { authorization: 'Bearer test-admin-key', accept: 'application/json' };
const POST_HEADERS = { ...AUTH, 'content-type': 'application/json' };
const CR_PATH = `${API}/changeRequests/ws/${WS}/environments/${ENV}`;
const CR = { workspace: WS, mnemonic: 'flag-change', description: 'Rollout step', changeNumber: 'CHG0001234', allowWrite: true };
const COMMENT = 'Rollout step\n\nChange number: CHG0001234';

async function run(def: AnyCommand, input: Record<string, unknown>, routes: Route[], options: { config?: Record<string, Record<string, unknown>>; files?: Record<string, string> } = {}) {
  const t = testContext({ config: options.config ?? config, routes, ...(options.files ? { files: options.files } : {}) });
  const envelope = await execute(def, input, t.context);
  return { envelope, calls: t.http.calls };
}

const get = (path: string, json: unknown, query?: Record<string, string>): Route => ({ method: 'GET', path, ...(query ? { query } : {}), respond: { json } });
const postCr: Route = { method: 'POST', path: CR_PATH, respond: (request) => ({ json: changeRequest(request) }) };
const sent = (call: { body: string | undefined }) => JSON.parse(call.body ?? 'null') as Record<string, unknown>;

describe('workspaces list', () => {
  it('reads every page, 100 at a time, until totalCount (#79 item 8 fixed)', async () => {
    const first = Array.from({ length: 100 }, (_, i) => workspace(i));
    const { envelope, calls } = await run(workspacesListCommand, {}, [
      get(`${API}/workspaces`, workspacesPage(first, 0, 101), { offset: '0', limit: '100' }),
      get(`${API}/workspaces`, workspacesPage([workspace(100)], 100, 101), { offset: '100', limit: '100' }),
    ]);
    expect(calls.map((c) => c.url)).toEqual([`${SPLIT}${API}/workspaces?offset=0&limit=100`, `${SPLIT}${API}/workspaces?offset=100&limit=100`]);
    expect(calls[0]!.headers).toEqual(AUTH);
    expect(envelope.data).toMatchObject({ count: 101 });
  });

  it('a 401 is AUTH, with where to make an Admin API key', async () => {
    const { envelope } = await run(workspacesListCommand, {}, [{ url: /.*/, respond: { status: 401, json: { code: 401, message: 'Unauthorized' } } }]);
    expect(envelope.error).toMatchObject({ code: 'AUTH', fix: expect.stringContaining('Admin settings → API keys') });
    expect(envelope.error?.fix).toContain('TOIL_SPLITIO_ADMIN_API_KEY');
  });
});

describe('environments list', () => {
  it('reads the bare array Split returns (#79 item 7 fixed)', async () => {
    const { envelope, calls } = await run(environmentsListCommand, { workspace: WS }, [get(`${API}/environments/ws/${WS}`, environments)]);
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/environments/ws/${WS}`);
    expect(envelope.data).toEqual({ count: 2, environments });
  });

  it('is an HTTP error, not a TypeError, when the answer is not an array', async () => {
    const { envelope } = await run(environmentsListCommand, { workspace: WS }, [get(`${API}/environments/ws/${WS}`, { objects: [] })]);
    expect(envelope.error).toMatchObject({ code: 'HTTP', message: expect.stringContaining('JSON array') });
  });

  it('takes the workspace from the connection, and says so', async () => {
    const { envelope, calls } = await run(environmentsListCommand, {}, [get(`${API}/environments/ws/ws-default`, environments)], { config: { splitio: { ...config.splitio, workspace: 'ws-default' } } });
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/environments/ws/ws-default`);
    expect(envelope.meta.context?.inputs?.workspace).toEqual({ value: 'ws-default', source: 'connection' });
  });

  it('with no workspace anywhere, fails before any request and says --workspace is the file-workspace flag', async () => {
    const { envelope, calls } = await run(environmentsListCommand, {}, []);
    expect(calls).toEqual([]);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Pass --ws <id>') });
    expect(envelope.error?.message).toContain("toil's --workspace is the folder");
  });

  it('on the CLI, --ws names the Split workspace and --workspace stays the global file workspace', async () => {
    const t = testContext({ config, routes: [get(`${API}/environments/ws/${WS}`, environments)] });
    const viaWs = await runCli(['splitio', 'environments', 'list', '--ws', WS], { commands, context: t.context });
    expect(JSON.parse(viaWs.stdout).ok).toBe(true);
    const viaWorkspace = await runCli(['splitio', 'environments', 'list', '--workspace', WS], { commands, context: testContext({ config }).context });
    expect(JSON.parse(viaWorkspace.stdout).error.message).toContain('Pass --ws <id>');
  });
});

describe('flags list', () => {
  it('GETs /splits/ws/{ws} with limit 50 and offset 0 by default, and returns count, totalCount and flags', async () => {
    const { envelope, calls } = await run(flagsListCommand, { workspace: WS }, [get(`${API}/splits/ws/${WS}`, flagsPage)]);
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/splits/ws/${WS}?limit=50&offset=0`);
    expect(envelope.data).toEqual({ count: 2, totalCount: 2, flags: flagsPage.objects });
    expect(envelope.meta.warnings).toBeUndefined();
  });

  it('keeps sending --flag-set as flagSetName, with a warning (#79 item 14, unsettled by the docs)', async () => {
    const { envelope, calls } = await run(flagsListCommand, { workspace: WS, limit: '10', offset: '20', flagSet: 'checkout' }, [get(`${API}/splits/ws/${WS}`, flagsPage)]);
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/splits/ws/${WS}?limit=10&offset=20&flagSetName=checkout`);
    expect(envelope.meta.warnings).toEqual([expect.objectContaining({ code: 'SPLITIO_FLAG_SET_FILTER' })]);
  });
});

describe('flags get', () => {
  it('uses /splits/ws/{ws}/{flag} and .../environments/{env}, with no name/ segment (#79 item 1 fixed)', async () => {
    const plain = await run(flagsGetCommand, { workspace: WS, flag: 'new checkout' }, [get(`${API}/splits/ws/${WS}/new%20checkout`, { name: 'new checkout' })]);
    expect(plain.calls[0]!.url).toBe(`${SPLIT}${API}/splits/ws/${WS}/new%20checkout`);
    const inEnv = await run(flagsGetCommand, { workspace: WS, flag: 'new_checkout', environment: ENV }, [get(`${API}/splits/ws/${WS}/new_checkout/environments/${ENV}`, definition)]);
    expect(inEnv.calls[0]!.url).toBe(`${SPLIT}${API}/splits/ws/${WS}/new_checkout/environments/${ENV}`);
    expect(inEnv.envelope.data).toEqual(definition);
  });
});

describe('change request writes', () => {
  it('kill POSTs to .../environments/{env} with a flat split, KILL, emails as strings and the change number in the comment (#79 items 2, 3, 4, 6 fixed)', async () => {
    const { envelope, calls } = await run(flagsKillCommand, { ...CR, flag: 'new_checkout', environment: ENV, approvers: ' you@example.com, lead@example.com ,' }, [postCr]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${SPLIT}${CR_PATH}`, headers: POST_HEADERS });
    expect(sent(calls[0]!)).toEqual({ split: { name: 'new_checkout' }, operationType: 'KILL', title: 'flag-change', comment: COMMENT, approvers: ['you@example.com', 'lead@example.com'] });
    expect(envelope.data).toMatchObject({ id: 'cr-abc12345', status: 'REQUESTED', operationType: 'KILL', title: 'flag-change' });
  });

  it('restore sends RESTORE, approvers [] when none are given, and rolloutStatus when given', async () => {
    const { calls } = await run(flagsRestoreCommand, { ...CR, flag: 'new_checkout', environment: ENV, rolloutStatus: 'rs-abc12345' }, [postCr]);
    expect(sent(calls[0]!)).toEqual({ split: { name: 'new_checkout' }, operationType: 'RESTORE', title: 'flag-change', comment: COMMENT, approvers: [], rolloutStatus: { id: 'rs-abc12345' } });
  });

  it('archive is CLI-only: it removes a flag definition, and deletes never go through MCP', () => {
    expect(flagsArchiveCommand.mcp).toBe(false);
  });

  it('archive needs an environment now, and sends ARCHIVE to its path', async () => {
    const { calls } = await run(flagsArchiveCommand, { ...CR, flag: 'old_banner', environment: ENV }, [postCr]);
    expect(calls[0]!.url).toBe(`${SPLIT}${CR_PATH}`);
    expect(sent(calls[0]!)).toMatchObject({ split: { name: 'old_banner' }, operationType: 'ARCHIVE' });
    const missing = await run(flagsArchiveCommand, { ...CR, flag: 'old_banner' }, []);
    expect(missing.envelope.error?.code).toBe('INVALID_INPUT');
    expect(missing.calls).toEqual([]);
  });

  it('is refused without --allow-write, and with writes off on the connection, before any request', async () => {
    const noFlag = await run(flagsKillCommand, { ...CR, allowWrite: undefined, flag: 'f', environment: ENV }, []);
    expect(noFlag.envelope.error?.code).toBe('WRITE_DISABLED');
    const off = await run(flagsKillCommand, { ...CR, flag: 'f', environment: ENV }, [], { config: { splitio: { ...config.splitio, writes: false } } });
    expect(off.envelope.error?.code).toBe('WRITE_DISABLED');
    expect([...noFlag.calls, ...off.calls]).toEqual([]);
  });

  it('toggle: "false" and "0" kill; anything else restores, "off" included (#79 item 11, kept as a suspected bug)', async () => {
    const op = async (enabled: string) => sent((await run(flagsToggleCommand, { ...CR, flag: 'f', environment: ENV, enabled }, [postCr])).calls[0]!).operationType;
    expect(await op('FALSE')).toBe('KILL');
    expect(await op('0')).toBe('KILL');
    expect(await op('true')).toBe('RESTORE');
    expect(await op('off')).toBe('RESTORE');
  });

  it('toggle warns when a value other than true or 1 restored the flag, and stays quiet otherwise', async () => {
    const warnings = async (enabled: string) => (await run(flagsToggleCommand, { ...CR, flag: 'f', environment: ENV, enabled }, [postCr])).envelope.meta.warnings;
    expect(await warnings('off')).toEqual([
      {
        code: 'SPLITIO_TOGGLE_RESTORED',
        message: `--enabled "off" isn't true or false, and anything but false or 0 counts as true, so this filed a RESTORE change request for f. If you meant to kill it, withdraw this request and run again with --enabled false.`,
      },
    ]);
    expect(await warnings('TRUE')).toBeUndefined();
    expect(await warnings('1')).toBeUndefined();
    expect(await warnings('false')).toBeUndefined();
  });
});

describe('flags update', () => {
  it('sends the --input-file object flat under split, with name from --flag and UPDATE', async () => {
    const files = { 'def.json': JSON.stringify({ name: 'ignored', defaultTreatment: 'off', defaultRule: [{ treatment: 'off', size: 100 }] }) };
    const { calls } = await run(flagsUpdateCommand, { ...CR, flag: 'new_checkout', environment: ENV, inputFile: 'def.json' }, [postCr], { files });
    expect(sent(calls[0]!)).toEqual({
      split: { name: 'new_checkout', defaultTreatment: 'off', defaultRule: [{ treatment: 'off', size: 100 }] },
      operationType: 'UPDATE',
      title: 'flag-change',
      comment: COMMENT,
      approvers: [],
    });
  });

  it('refuses a missing --input-file, bad JSON and a non-object, before any request', async () => {
    const missing = await run(flagsUpdateCommand, { ...CR, flag: 'f', environment: ENV }, []);
    expect(missing.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--input-file is required for flags update' });
    const bad = await run(flagsUpdateCommand, { ...CR, flag: 'f', environment: ENV, inputFile: 'd.json' }, [], { files: { 'd.json': '{nope' } });
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--input-file must be valid JSON') });
    const arr = await run(flagsUpdateCommand, { ...CR, flag: 'f', environment: ENV, inputFile: 'd.json' }, [], { files: { 'd.json': '[]' } });
    expect(arr.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('JSON object') });
    expect([...missing.calls, ...bad.calls, ...arr.calls]).toEqual([]);
  });
});

describe('flags set-rule and set-default', () => {
  const defRoute = get(`${API}/splits/ws/${WS}/new_checkout/environments/${ENV}`, definition);

  it('set-rule GETs the definition, replaces one rule with a 100% bucket, and sends only the writable fields (#79 items 1, 5, 6 fixed)', async () => {
    const { calls } = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: '1', treatment: 'on' }, [defRoute, postCr]);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    const body = sent(calls[1]!);
    expect(body.split).toEqual({
      name: 'new_checkout',
      treatments: definition.treatments,
      defaultTreatment: 'off',
      baselineTreatment: 'off',
      trafficAllocation: 100,
      rules: [definition.rules[0], { ...definition.rules[1], buckets: [{ treatment: 'on', size: 100 }] }],
      defaultRule: definition.defaultRule,
    });
    expect(body.operationType).toBe('UPDATE');
  });

  it('set-rule --weights sends the parsed array; bad JSON is INVALID_INPUT, not a raw SyntaxError', async () => {
    const weights = [{ treatment: 'on', size: 20 }, { treatment: 'off', size: 80 }];
    const ok = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: 0, weights: JSON.stringify(weights) }, [defRoute, postCr]);
    expect((sent(ok.calls[1]!).split as { rules: Array<{ buckets: unknown }> }).rules[0]!.buckets).toEqual(weights);
    const bad = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: 0, weights: '[{' }, [defRoute]);
    expect(bad.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--weights must be valid JSON') });
    const obj = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: 0, weights: '{"treatment":"on"}' }, [defRoute, postCr]);
    expect(obj.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--weights must be a JSON array of {treatment, size} objects.' });
    expect(obj.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('set-rule needs --treatment or --weights, and an index inside the rules, with the old messages', async () => {
    const neither = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: '0' }, []);
    expect(neither.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'Either --treatment or --weights must be specified' });
    expect(neither.calls).toEqual([]);
    const out = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: '2', treatment: 'on' }, [defRoute]);
    expect(out.envelope.error?.message).toBe('Rule index 2 is out of range (flag has 2 rules)');
    const nan = await run(flagsSetRuleCommand, { ...CR, flag: 'new_checkout', environment: ENV, ruleIndex: 'x', treatment: 'on' }, [defRoute]);
    expect(nan.envelope.error?.message).toBe('Rule index "x" is out of range (flag has 2 rules)');
  });

  it('set-default writes defaultRule as one 100% bucket', async () => {
    const { calls } = await run(flagsSetDefaultCommand, { ...CR, flag: 'new_checkout', environment: ENV, treatment: 'on' }, [defRoute, postCr]);
    expect((sent(calls[1]!).split as Record<string, unknown>).defaultRule).toEqual([{ treatment: 'on', size: 100 }]);
  });
});

describe('flags batch-toggle', () => {
  it('files one change request per entry, titled "<mnemonic> — <flag>", and carries on after a failure', async () => {
    const files = { 't.json': JSON.stringify([{ flag: 'a', enabled: false }, { flag: 'b', enabled: 'false' }, { flag: 'c', enabled: true }]) };
    let n = 0;
    const route: Route = { method: 'POST', path: CR_PATH, respond: (request) => (++n === 3 ? { status: 409, json: { code: 409, message: 'Open change request exists' } } : { json: changeRequest(request) }) };
    const { envelope, calls } = await run(flagsBatchToggleCommand, { ...CR, environment: ENV, inputFile: 't.json' }, [route], { files });
    expect(calls.map((c) => [sent(c).title, sent(c).operationType])).toEqual([
      ['flag-change — a', 'KILL'],
      // Suspected bug (#79 item 12), kept: the string "false" is truthy, so it restores.
      ['flag-change — b', 'RESTORE'],
      ['flag-change — c', 'RESTORE'],
    ]);
    // Suspected bug (#79 item 12), kept: ok even though an entry failed; the warning is new.
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toMatchObject({ submitted: 3, results: [{ flag: 'a', ok: true, id: 'cr-abc12345' }, { flag: 'b', ok: true }, { flag: 'c', ok: false, error: expect.stringContaining('Open change request exists') }] });
    expect(envelope.meta.warnings).toEqual([{ code: 'SPLITIO_BATCH_PARTIAL', message: '1 of 3 change requests failed; see results[].error.' }]);
  });

  it('refuses a missing file or a non-array before any request', async () => {
    const missing = await run(flagsBatchToggleCommand, { ...CR, environment: ENV }, []);
    expect(missing.envelope.error?.message).toBe('--input-file is required for batch-toggle');
    const notArray = await run(flagsBatchToggleCommand, { ...CR, environment: ENV, inputFile: 't.json' }, [], { files: { 't.json': '{}' } });
    expect(notArray.envelope.error?.message).toBe('Input file must be a JSON array of {flag, enabled} objects');
  });

  it('refuses an entry without a flag name, naming its index, before any request is filed', async () => {
    for (const body of ['[{"enabled":false}]', '[null]', '[1]', '[{"flag":"a","enabled":false},null]', '[{"flag":"","enabled":true}]']) {
      const { envelope, calls } = await run(flagsBatchToggleCommand, { ...CR, environment: ENV, inputFile: 't.json' }, [postCr], { files: { 't.json': body } });
      expect(envelope.error, body).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/^Entry \d of --input-file needs a "flag" name/) });
      expect(calls, body).toEqual([]);
    }
  });
});

describe('change-requests', () => {
  it('list GETs /changeRequests with workspaceId and the filters, and reports the next marker (#79 item 9 fixed)', async () => {
    const { envelope, calls } = await run(changeRequestsListCommand, { workspace: WS, environment: ENV, status: 'APPROVED', limit: '10', after: 'marker-1' }, [get(`${API}/changeRequests`, changeRequestList)]);
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/changeRequests?workspaceId=${WS}&environmentId=${ENV}&status=APPROVED&limit=10&after=marker-1`);
    expect(envelope.data).toEqual({ count: 1, totalCount: null, changeRequests: [storedChangeRequest], nextMarker: 'marker-abc12346', previousMarker: null });
    expect(envelope.meta.page).toEqual({ nextCursor: 'marker-abc12346', limit: 10 });
  });

  it('list sends limit 25 by default and refuses an offset other than 0, since Split pages by marker', async () => {
    const plain = await run(changeRequestsListCommand, { workspace: WS }, [get(`${API}/changeRequests`, { data: [] })]);
    expect(plain.calls[0]!.url).toBe(`${SPLIT}${API}/changeRequests?workspaceId=${WS}&limit=25`);
    expect(plain.envelope.data).toMatchObject({ count: 0, nextMarker: null });
    const offset = await run(changeRequestsListCommand, { workspace: WS, offset: '5' }, []);
    expect(offset.envelope.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('--after') });
    expect(offset.calls).toEqual([]);
  });

  it('get GETs /changeRequests/{id} with no workspace (#79 item 10: the docs have this endpoint)', async () => {
    const { envelope, calls } = await run(changeRequestsGetCommand, { id: 'cr-abc12345' }, [get(`${API}/changeRequests/cr-abc12345`, storedChangeRequest)]);
    expect(calls[0]!.url).toBe(`${SPLIT}${API}/changeRequests/cr-abc12345`);
    expect(envelope.data).toEqual(storedChangeRequest);
  });
});

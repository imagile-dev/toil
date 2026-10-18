import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Connection } from 'tedious';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSchemas } from '../../src/areas/db/index.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import { connectionConfig, serverSpn } from '../../src/core/db/sqlserver/index.js';
import { tediousSupportsSspi, useExchange } from '../../src/core/db/sqlserver/windows-login.js';
import { execute } from '../../src/core/run.js';
import { bootstrapLine, helperEnv, powershellPath, startSspi, type HelperSpawner } from '../../src/os/windows-sspi.js';
import { testContext } from '../harness/context.js';
import { startSspiServer } from '../harness/sspi-server.js';

/**
 * SQL Server's Windows authentication: the connection rules, the SSPI
 * helper's protocol with its process stubbed, the two tedious methods toil
 * wraps, and, on Windows only, the real helper against Windows' own SSPI.
 * The live handshake with a SQL Server on a domain has not been run; the
 * docs say so. Tests that need Windows say so in their names, and skip
 * elsewhere for that reason alone.
 */

const onWindows = process.platform === 'win32';
const conn = { name: 'db', area: 'db', engine: 'sqlserver', host: 'sql.imagile.dev', database: 'app', auth: 'windows' } as unknown as DbConnection;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sqlserver windows authentication: connection rules', () => {
  const run = (settings: Record<string, unknown>) => {
    const { context } = testContext({ config: { db: settings } });
    return execute(listSchemas, {}, context);
  };

  it('refuses auth windows on macOS and Linux before connecting, naming the SQL login alternative', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const envelope = await run({ engine: 'sqlserver', host: '127.0.0.1', port: 1, database: 'app', auth: 'windows' });
    expect(envelope.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_AUTH') });
    // Core names the key in the message; the reason, and the alternative, are in details.
    const details = JSON.stringify((envelope.error as { details?: unknown }).details);
    expect(details).toContain('only on Windows');
    expect(details).toContain('SQL Server login');
  });

  it('needs user for a SQL login, and not for Windows authentication', async () => {
    const sqlLogin = await run({ engine: 'sqlserver', host: '127.0.0.1', port: 1, database: 'app' });
    expect(sqlLogin.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_USER') });
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const windows = await run({ engine: 'sqlserver', host: '127.0.0.1', port: 1, database: 'app', auth: 'windows', domain: 'IMAGILE' });
    expect(windows.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_USER') });
    const domainOnSql = await run({ engine: 'sqlserver', host: '127.0.0.1', port: 1, database: 'app', user: 'u', domain: 'IMAGILE' });
    expect(domainOnSql.error).toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('TOIL_DB_DOMAIN') });
  });

  it("configures tedious's NTLM path, with nothing of tedious's own NTLM credentials, and the server's SPN", () => {
    expect(connectionConfig(conn).authentication).toEqual({ type: 'ntlm', options: { domain: '' } });
    expect(serverSpn(conn)).toBe('MSSQLSvc/sql.imagile.dev:1433');
    expect(serverSpn({ ...conn, port: 14330 } as DbConnection)).toBe('MSSQLSvc/sql.imagile.dev:14330');
  });
});

/** A helper process that answers from a script, recording what toil wrote to it. */
function fakeHelper(answer: (line: string, index: number) => string | undefined) {
  const written: string[] = [];
  let killed = false;
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const exit = new EventEmitter();
  let buffer = '';
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      written.push(line);
      const out = answer(line, written.length - 1);
      if (out !== undefined) stdout.write(out + '\n');
    }
  });
  const spawner: HelperSpawner = (env) => {
    expect(Object.keys(env).filter((k) => k.startsWith('TOIL_'))).toEqual([]);
    return { stdin, stdout, stderr: new PassThrough(), kill: () => void ((killed = true), stdout.end(), exit.emit('exit', null)), on: (e, l) => void exit.on(e, l) };
  };
  return { spawner, written, killed: () => killed };
}

describe('sqlserver windows authentication: the SSPI helper protocol', () => {
  const signal = () => new AbortController().signal;

  it('sends the script and the request on stdin, never in argv, and relays tokens as base64', async () => {
    vi.stubEnv('TOIL_DB_PASSWORD', 'not-for-the-helper');
    const helper = fakeHelper((line, i) => (i === 0 ? 'READY' : i === 1 ? `TOKEN ${Buffer.from('first').toString('base64')}` : `TOKEN ${Buffer.from(`re:${Buffer.from(line, 'base64')}`).toString('base64')}`));
    const exchange = await startSspi('db', { spn: 'MSSQLSvc/sql.imagile.dev:1433', account: { domain: 'IMAGILE', user: 'svc', password: 'p@ss' } }, signal(), helper.spawner, 'win32');
    expect(exchange.first.toString()).toBe('first');
    expect((await exchange.next(Buffer.from('challenge'))).toString()).toBe('re:challenge');
    exchange.close();
    expect(helper.written[0]).toBe(bootstrapLine());
    expect(bootstrapLine()).not.toContain('p@ss');
    expect(JSON.parse(helper.written[1]!)).toEqual({ spn: 'MSSQLSvc/sql.imagile.dev:1433', domain: 'IMAGILE', user: 'svc', password: 'p@ss' });
    expect(helper.written[2]).toBe(Buffer.from('challenge').toString('base64'));
    expect(helper.killed()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('signs in as the current Windows user when no account is set', async () => {
    const helper = fakeHelper((_, i) => (i === 0 ? 'READY' : 'TOKEN AQI='));
    const exchange = await startSspi('db', { spn: 'MSSQLSvc/sql.imagile.dev:1433' }, signal(), helper.spawner, 'win32');
    exchange.close();
    expect(JSON.parse(helper.written[1]!)).toEqual({ spn: 'MSSQLSvc/sql.imagile.dev:1433', domain: null, user: null, password: null });
  });

  it('says Constrained Language Mode plainly, not as a failed login', async () => {
    const helper = fakeHelper(() => 'ERR CLM ConstrainedLanguage');
    await expect(startSspi('db', { spn: 's' }, signal(), helper.spawner, 'win32')).rejects.toMatchObject({
      code: 'AUTH',
      message: expect.stringContaining('ConstrainedLanguage'),
      fix: expect.stringContaining('SQL Server login'),
    });
    expect(helper.killed()).toBe(true);
  });

  it("reports SSPI's own refusal, and a helper that stops answering", async () => {
    const refused = fakeHelper((_, i) => (i === 0 ? 'READY' : 'ERR SSPI InitializeSecurityContext failed for s: 0x80090311'));
    await expect(startSspi('db', { spn: 's' }, signal(), refused.spawner, 'win32')).rejects.toMatchObject({ code: 'AUTH', message: expect.stringContaining('0x80090311') });
    const silent = fakeHelper(() => undefined);
    const pending = startSspi('db', { spn: 's' }, signal(), silent.spawner, 'win32');
    (silent.spawner({}).stdout as PassThrough).end();
    await expect(pending).rejects.toMatchObject({ code: 'AUTH', message: expect.stringContaining('stopped without answering') });
  });

  it('never starts the helper off Windows', async () => {
    const helper = fakeHelper(() => 'READY');
    const spy = vi.fn(helper.spawner);
    await expect(startSspi('db', { spn: 's' }, signal(), spy, 'darwin')).rejects.toMatchObject({ code: 'CONFIG_INVALID', fix: expect.stringContaining('SQL Server login') });
    expect(spy).not.toHaveBeenCalled();
  });

  it('kills the helper when the call is cancelled', async () => {
    const controller = new AbortController();
    const helper = fakeHelper(() => undefined);
    const pending = startSspi('db', { spn: 's' }, controller.signal, helper.spawner, 'win32');
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(helper.killed()).toBe(true);
  });

  it('passes the helper only an allowlist of the environment', () => {
    const env = helperEnv({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', TOIL_DB_PASSWORD: 'x', GITHUB_TOKEN: 'y' });
    expect(env).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp' });
    expect(powershellPath({ SystemRoot: 'C:\\Windows' })).toMatch(/^C:\\Windows[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
  });
});

describe("sqlserver windows authentication: tedious's login, wrapped", () => {
  it('still finds the tedious methods it wraps', () => {
    expect(tediousSupportsSspi()).toBe(true);
  });

  type Internal = Connection & Record<string, unknown> & { sendLogin7Packet(): void; performSentLogin7WithNTLMLogin(signal: AbortSignal): Promise<unknown> };

  function marked(next: (token: Buffer) => Buffer) {
    const connection = new Connection({ server: 'sql.imagile.dev', authentication: { type: 'ntlm', options: { domain: '' } }, options: { port: 1433 } }) as Internal;
    const sent: Array<{ type: number; data: Buffer }> = [];
    connection.messageIo = { sendMessage: (type: number, data: Buffer) => sent.push({ type, data }) } as never;
    useExchange(connection, { first: Buffer.from('FIRST-TOKEN-BYTES'), next: async (t) => next(t), close: () => {} });
    return { connection, sent };
  }

  it('puts the exchange\'s first token in the login packet', () => {
    const { connection, sent } = marked((t) => t);
    connection.sendLogin7Packet();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe(0x10);
    expect(sent[0]!.data.includes(Buffer.from('FIRST-TOKEN-BYTES'))).toBe(true);
    expect(sent[0]!.data.includes(Buffer.from('NTLMSSP'))).toBe(false);
  });

  it("answers each server token with the exchange's, as an SSPI message, until the login is acknowledged", async () => {
    const { connection, sent } = marked((t) => Buffer.from(`answer-to-${t}`));
    const rounds = [
      (c: Internal) => void ((c.ntlmpacket = {}), (c.ntlmpacketBuffer = Buffer.from('challenge'))),
      (_c: Internal, handler: Record<string, unknown>) => void ((handler.loginAckReceived = true), (handler.routingData = undefined)),
    ];
    let round = 0;
    Object.assign(connection.messageIo as object, { readMessage: async () => ({}) });
    connection.createTokenStreamParser = ((_message: unknown, handler: Record<string, unknown>) => {
      const parser = new EventEmitter();
      const step = rounds[round++]!;
      setImmediate(() => {
        step(connection, handler);
        parser.emit('end');
      });
      return parser;
    }) as never;
    await connection.performSentLogin7WithNTLMLogin(new AbortController().signal);
    expect(sent).toEqual([{ type: 0x11, data: Buffer.from('answer-to-challenge') }]);
    expect(round).toBe(2);
  });

  it("leaves an unmarked connection on tedious's own path", () => {
    const connection = new Connection({ server: 'sql.imagile.dev', authentication: { type: 'ntlm', options: { domain: 'IMAGILE' } }, options: { port: 1433 } }) as Internal;
    const sent: Buffer[] = [];
    connection.messageIo = { sendMessage: (_: number, data: Buffer) => sent.push(data) } as never;
    connection.sendLogin7Packet();
    expect(sent[0]!.includes(Buffer.from('NTLMSSP'))).toBe(true);
  });
});

describe.skipIf(!onWindows)('sqlserver windows authentication: the real helper (Windows only)', () => {
  it('windows only: completes a multi-leg Negotiate handshake that Windows SSPI accepts as the current user', async () => {
    const server = await startSspiServer();
    const exchange = await startSspi('db', { spn: 'MSSQLSvc/localhost:1433' }, new AbortController().signal);
    try {
      let reply = await server.accept(exchange.first);
      let legs = 1;
      while (reply.status !== 0) {
        expect(reply.status, `SSPI status 0x${reply.status.toString(16)}`).toBe(0x90312);
        reply = await server.accept(await exchange.next(reply.token));
        legs++;
      }
      expect(legs).toBeGreaterThan(1);
      expect(reply.user).not.toBe('');
    } finally {
      exchange.close();
      server.close();
    }
  }, 60_000);

  it('windows only: refuses to run in Constrained Language Mode, saying so', async () => {
    // A session switched to Constrained Language Mode before the helper's line arrives, as a WDAC or AppLocker policy would start it.
    const constrained: HelperSpawner = (env) => {
      const child = spawn(powershellPath(env), ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, env });
      child.stdin.write("$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n");
      return child;
    };
    await expect(startSspi('db', { spn: 'MSSQLSvc/localhost:1433' }, new AbortController().signal, constrained)).rejects.toMatchObject({
      code: 'AUTH',
      message: expect.stringContaining('ConstrainedLanguage'),
    });
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { createSecretStore, spawnProgram, storeVerified, WINDOWS_SCRIPT, type SecretStore, type SpawnResult, type Spawner } from './keychain.js';

const SECRET = 'fake-token-abc12345';

/** A spawner that records every call and answers from `respond`; nothing real ever runs. */
function recorder(respond: (command: string, args: string[], input: string) => Partial<SpawnResult> = () => ({})) {
  const calls: Array<{ command: string; args: string[]; input: string }> = [];
  const spawn: Spawner = (command, args, input) => {
    calls.push({ command, args, input });
    return { status: 0, stdout: '', stderr: '', ...respond(command, args, input) };
  };
  return { spawn, calls };
}

const enoent = (): Partial<SpawnResult> => ({ status: null, error: Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' }) });

function expectSecretOnlyOnStdin(calls: Array<{ args: string[]; input: string }>, onStdin: string) {
  for (const call of calls) expect(call.args.join(' ')).not.toContain(SECRET);
  expect(calls.some((c) => c.input.includes(onStdin))).toBe(true);
}

describe('macOS store (security)', () => {
  it('stores through `security -i` with the secret hex-encoded on stdin, never on argv', () => {
    const { spawn, calls } = recorder();
    createSecretStore({ platform: 'darwin', spawn }).set('corp-jira.token', SECRET);
    expect(calls).toEqual([
      { command: 'security', args: ['-i'], input: `add-generic-password -U -s toil -a corp-jira.token -l "toil corp-jira.token" -X ${Buffer.from(SECRET).toString('hex')}\n` },
    ]);
    expectSecretOnlyOnStdin(calls, Buffer.from(SECRET).toString('hex'));
  });

  it('reads with find-generic-password -w, and treats exit 44 as no entry', () => {
    const found = recorder(() => ({ stdout: `${SECRET}\n` }));
    expect(createSecretStore({ platform: 'darwin', spawn: found.spawn }).get('corp-jira.token')).toBe(SECRET);
    expect(found.calls[0]).toMatchObject({ command: 'security', args: ['find-generic-password', '-s', 'toil', '-a', 'corp-jira.token', '-w'] });
    const missing = recorder(() => ({ status: 44 }));
    expect(createSecretStore({ platform: 'darwin', spawn: missing.spawn }).get('corp-jira.token')).toBeUndefined();
  });

  it('deletes, saying whether there was an entry', () => {
    expect(createSecretStore({ platform: 'darwin', spawn: recorder().spawn }).delete('corp-jira.token')).toBe(true);
    expect(createSecretStore({ platform: 'darwin', spawn: recorder(() => ({ status: 44 })).spawn }).delete('corp-jira.token')).toBe(false);
  });

  it('fails a store when security reports an error on stderr', () => {
    const store = createSecretStore({ platform: 'darwin', spawn: recorder(() => ({ stderr: 'security: SecKeychainItemCreateFromContent: error' })).spawn });
    expect(() => store.set('corp-jira.token', SECRET)).toThrow(expect.objectContaining({ code: 'CREDENTIAL_STORE' }));
  });
});

describe('Windows store (Credential Manager through PowerShell)', () => {
  const decodeScript = (args: string[]) => Buffer.from(args[args.length - 1]!, 'base64').toString('utf16le');

  it('runs the constant advapi32 script with the request, secret included, as JSON on stdin', () => {
    const { spawn, calls } = recorder(() => ({ stdout: '{"ok":true}' }));
    createSecretStore({ platform: 'win32', spawn }).set('corp-jira.token', SECRET);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('powershell.exe');
    expect(calls[0]!.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(decodeScript(calls[0]!.args)).toBe(WINDOWS_SCRIPT);
    expect(JSON.parse(calls[0]!.input)).toEqual({ op: 'set', target: 'toil:corp-jira.token', user: 'corp-jira.token', secret: SECRET });
    expectSecretOnlyOnStdin(calls, SECRET);
  });

  it('uses CredRead, CredWrite and CredDelete from advapi32', () => {
    for (const fn of ['CredReadW', 'CredWriteW', 'CredDeleteW']) expect(WINDOWS_SCRIPT).toContain(`advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]\n  private static extern bool ${fn}`);
  });

  it('reads a secret, and a null as no entry', () => {
    const found = recorder(() => ({ stdout: JSON.stringify({ secret: SECRET }) }));
    expect(createSecretStore({ platform: 'win32', spawn: found.spawn }).get('corp-jira.token')).toBe(SECRET);
    expect(JSON.parse(found.calls[0]!.input)).toEqual({ op: 'get', target: 'toil:corp-jira.token' });
    expect(createSecretStore({ platform: 'win32', spawn: recorder(() => ({ stdout: '{"secret":null}' })).spawn }).get('corp-jira.token')).toBeUndefined();
  });

  it('deletes, saying whether there was an entry', () => {
    expect(createSecretStore({ platform: 'win32', spawn: recorder(() => ({ stdout: '{"deleted":true}' })).spawn }).delete('corp-jira.token')).toBe(true);
    expect(createSecretStore({ platform: 'win32', spawn: recorder(() => ({ stdout: '{"deleted":false}' })).spawn }).delete('corp-jira.token')).toBe(false);
  });

  it('falls back to pwsh when Windows PowerShell is missing', () => {
    const { spawn, calls } = recorder((command) => (command === 'powershell.exe' ? enoent() : { stdout: '{"secret":"x"}' }));
    expect(createSecretStore({ platform: 'win32', spawn }).get('corp-jira.token')).toBe('x');
    expect(calls.map((c) => c.command)).toEqual(['powershell.exe', 'pwsh']);
  });
});

describe('Linux store (secret-tool)', () => {
  it('stores with the secret on stdin, never on argv', () => {
    const { spawn, calls } = recorder();
    createSecretStore({ platform: 'linux', spawn }).set('corp-jira.token', SECRET);
    expect(calls).toEqual([{ command: 'secret-tool', args: ['store', '--label=toil corp-jira.token', 'service', 'toil', 'account', 'corp-jira.token'], input: SECRET }]);
    expectSecretOnlyOnStdin(calls, SECRET);
  });

  it('reads with lookup; a silent exit 1 is no entry, one with an error is a failure', () => {
    const found = recorder(() => ({ stdout: SECRET }));
    expect(createSecretStore({ platform: 'linux', spawn: found.spawn }).get('corp-jira.token')).toBe(SECRET);
    expect(found.calls[0]!.args).toEqual(['lookup', 'service', 'toil', 'account', 'corp-jira.token']);
    expect(createSecretStore({ platform: 'linux', spawn: recorder(() => ({ status: 1 })).spawn }).get('corp-jira.token')).toBeUndefined();
    const locked = createSecretStore({ platform: 'linux', spawn: recorder(() => ({ status: 1, stderr: 'Cannot autolaunch D-Bus' })).spawn });
    expect(() => locked.get('corp-jira.token')).toThrow(expect.objectContaining({ code: 'CREDENTIAL_STORE' }));
  });

  it('deletes with clear only when there is an entry', () => {
    const present = recorder((_c, args) => (args[0] === 'lookup' ? { stdout: SECRET } : {}));
    expect(createSecretStore({ platform: 'linux', spawn: present.spawn }).delete('corp-jira.token')).toBe(true);
    expect(present.calls.map((c) => c.args[0])).toEqual(['lookup', 'clear']);
    const absent = recorder(() => ({ status: 1 }));
    expect(createSecretStore({ platform: 'linux', spawn: absent.spawn }).delete('corp-jira.token')).toBe(false);
    expect(absent.calls.map((c) => c.args[0])).toEqual(['lookup']);
  });
});

describe('when the store is unavailable', () => {
  const cases: Array<[NodeJS.Platform, Spawner]> = [
    ['darwin', recorder(enoent).spawn],
    ['win32', recorder(enoent).spawn],
    ['linux', recorder(enoent).spawn],
  ];
  for (const [platform, spawn] of cases) {
    it(`${platform}: a ToilError whose fix names the connection's env var and --plaintext`, () => {
      const store = createSecretStore({ platform, spawn });
      for (const call of [() => store.set('corp-jira.token', SECRET), () => store.get('corp-jira.token')]) {
        expect(call).toThrow(expect.objectContaining({ code: 'CREDENTIAL_STORE', fix: expect.stringMatching(/TOIL_CONN_CORP_JIRA_TOKEN.*--plaintext/) }));
      }
    });
  }

  it('an unsupported platform has no store, and says so the same way', () => {
    const { spawn, calls } = recorder();
    const store = createSecretStore({ platform: 'aix', spawn });
    expect(() => store.set('corp-jira.token', SECRET)).toThrow(expect.objectContaining({ code: 'CREDENTIAL_STORE', fix: expect.stringContaining('TOIL_CONN_CORP_JIRA_TOKEN') }));
    expect(calls).toHaveLength(0);
  });
});

describe('every store', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    it(`${platform}: refuses a reference that isn't a plain name, before spawning anything`, () => {
      const { spawn, calls } = recorder();
      const store = createSecretStore({ platform, spawn });
      for (const bad of ['', 'a b', 'x;rm -rf', '-s', 'a"b', '../x']) expect(() => store.get(bad)).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
      expect(calls).toHaveLength(0);
    });

    it(`${platform}: refuses an empty or multi-line secret`, () => {
      const store = createSecretStore({ platform, spawn: recorder().spawn });
      expect(() => store.set('a.token', '')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
      expect(() => store.set('a.token', 'one\ntwo')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    });
  }
});

describe('storeVerified', () => {
  it('reads the secret back after storing it, and fails when it differs', () => {
    const entries = new Map<string, string>();
    const good: SecretStore = { name: 'fake', get: (r) => entries.get(r), set: (r, s) => void entries.set(r, s), delete: (r) => entries.delete(r) };
    storeVerified(good, 'a.token', SECRET);
    expect(entries.get('a.token')).toBe(SECRET);
    const lossy: SecretStore = { ...good, set: () => {} };
    expect(() => storeVerified(lossy, 'b.token', SECRET)).toThrow(expect.objectContaining({ code: 'CREDENTIAL_STORE' }));
  });
});

describe('spawnProgram', () => {
  // Runs Node itself, not a credential store, to prove how the real spawner delivers input.
  it('delivers input on stdin and passes arguments verbatim, with no shell', () => {
    const r = spawnProgram(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)', '$HOME %PATH% ;|&'], SECRET);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(SECRET);
    const echoed = spawnProgram(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$HOME %PATH% ;|&'], '');
    expect(echoed.stdout).toBe('$HOME %PATH% ;|&');
  });
});

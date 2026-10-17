import { spawnSync } from 'node:child_process';
import { connectionEnvName } from './config.js';
import { ToilError } from './errors.js';

/**
 * The OS credential store, and the only module in toil allowed to spawn a
 * process (CLAUDE.md, No Executables). It runs what the OS already ships and
 * nothing else:
 *
 *   macOS    `security` (the login Keychain)
 *   Windows  Windows PowerShell, calling advapi32 CredRead/CredWrite/CredDelete
 *            (Credential Manager)
 *   Linux    `secret-tool` (the Secret Service: GNOME Keyring, KWallet)
 *
 * Every entry lives under the service `toil`, with the reference name as the
 * account. Config holds `keychain:<ref>`, never the secret.
 *
 * Secrets travel to the child on stdin, never on argv, because argv is visible
 * to every process on the machine. Nothing is spawned through a shell, and
 * every argument is a fixed string or a reference name checked against
 * REF_NAME first. The store is optional: env vars and plaintext config work
 * with no store at all, which is how CI runs.
 *
 * Spawning was approved by a committee of one file, which met, quorate, and
 * minuted that it would not be spawning anything else.
 */

export const KEYCHAIN_PREFIX = 'keychain:';
export const SERVICE = 'toil';

/** Reference names are `<connection>.<key>`; anything stricter would also do. */
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

/** Runs one program with fixed arguments and `input` on stdin. Injected so tests never touch a real store. */
export type Spawner = (command: string, args: string[], input: string) => SpawnResult;

export const spawnProgram: Spawner = (command, args, input) => {
  const r = spawnSync(command, args, { input, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};

export interface SecretStore {
  /** What the user would call it, for messages: "Windows Credential Manager". */
  readonly name: string;
  /** The secret, or undefined when there's no entry. Throws a ToilError when the store can't be reached. */
  get(ref: string): string | undefined;
  set(ref: string, secret: string): void;
  /** Whether there was an entry to delete. */
  delete(ref: string): boolean;
}

export function isKeychainRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(KEYCHAIN_PREFIX);
}

/** `keychain:corp-jira.token` -> `corp-jira.token`. */
export function refName(value: string): string {
  return value.slice(KEYCHAIN_PREFIX.length);
}

/** The reference toil writes for a key on a connection. */
export function refFor(connection: string, key: string): string {
  return `${connection}.${key}`;
}

/**
 * The fix for a store that can't be used: the env var for that one key when
 * the reference is one toil wrote, and --plaintext either way.
 */
function unavailable(store: string, ref: string, detail: string): ToilError {
  const [connection, key] = ref.split('.');
  const variable = connection && key ? connectionEnvName(connection, key) : 'TOIL_CONN_<NAME>_<KEY>';
  return new ToilError('CREDENTIAL_STORE', `The OS credential store (${store}) isn't available: ${detail}`, {
    fix: `Set ${variable} instead, or pass --plaintext to keep the secret in your toil config file.`,
  });
}

function failed(store: string, action: string, ref: string, r: SpawnResult): ToilError {
  if (r.error) return unavailable(store, ref, r.error.message);
  const detail = r.stderr.trim() || `exit code ${r.status}`;
  return new ToilError('CREDENTIAL_STORE', `${store} could not ${action} "${ref}": ${detail}`, {
    fix: `Check that ${store} is unlocked and working, or set the secret with an env var instead.`,
  });
}

function checkRef(ref: string): void {
  if (!REF_NAME.test(ref)) {
    throw new ToilError('CONFIG_INVALID', `"${KEYCHAIN_PREFIX}${ref}" isn't a valid credential store reference.`, {
      fix: 'Use letters, digits, ".", "_" and "-", e.g. keychain:corp-jira.token.',
    });
  }
}

function checkSecret(secret: string): void {
  if (secret === '' || /[\r\n]/.test(secret)) {
    throw new ToilError('INVALID_INPUT', 'A secret must be one non-empty line.', { fix: 'Paste the token again, without line breaks.' });
  }
}

function macos(run: Spawner): SecretStore {
  const name = 'macOS Keychain';
  return {
    name,
    get(ref) {
      checkRef(ref);
      const r = run('security', ['find-generic-password', '-s', SERVICE, '-a', ref, '-w'], '');
      if (r.status === 44) return undefined; // errSecItemNotFound
      if (r.error || r.status !== 0) throw failed(name, 'read', ref, r);
      return r.stdout.replace(/\r?\n$/, '');
    },
    set(ref, secret) {
      checkRef(ref);
      checkSecret(secret);
      // `security -i` reads its command from stdin, so the secret stays off
      // argv. Hex (-X) means no quoting rules apply to what's inside it.
      const hex = Buffer.from(secret, 'utf8').toString('hex');
      const r = run('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${ref} -l "toil ${ref}" -X ${hex}\n`);
      if (r.error || r.status !== 0 || /error/i.test(r.stderr)) throw failed(name, 'store', ref, r);
    },
    delete(ref) {
      checkRef(ref);
      const r = run('security', ['delete-generic-password', '-s', SERVICE, '-a', ref], '');
      if (r.status === 44) return false;
      if (r.error || r.status !== 0) throw failed(name, 'delete', ref, r);
      return true;
    },
  };
}

/**
 * Credential Manager has no shipped CLI that reads a secret back (`cmdkey`
 * only writes and lists), so this calls advapi32 from the Windows PowerShell
 * every Windows install has. The script is a constant; the request, secret
 * included, arrives as JSON on stdin. Blobs are UTF-8.
 */
export const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ToilCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr cred);
  private const int NotFound = 1168;
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int err = Marshal.GetLastWin32Error();
      if (err == NotFound) return null;
      throw new System.ComponentModel.Win32Exception(err);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] bytes = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
      return Encoding.UTF8.GetString(bytes);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string secret) {
    byte[] bytes = Encoding.UTF8.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = bytes.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, c.CredentialBlob, bytes.Length);
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, 1, 0)) return true;
    int err = Marshal.GetLastWin32Error();
    if (err == NotFound) return false;
    throw new System.ComponentModel.Win32Exception(err);
  }
}
'@
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($req.op) {
  'get' { [Console]::Out.Write((ConvertTo-Json -InputObject @{ secret = [ToilCredMan]::Read($req.target) } -Compress)) }
  'set' { [ToilCredMan]::Write($req.target, $req.user, $req.secret); [Console]::Out.Write('{"ok":true}') }
  'delete' { [Console]::Out.Write((ConvertTo-Json -InputObject @{ deleted = [ToilCredMan]::Delete($req.target) } -Compress)) }
}
`;

function windows(run: Spawner): SecretStore {
  const name = 'Windows Credential Manager';
  // -EncodedCommand carries the constant script; nothing user-supplied is in it.
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')];
  const invoke = (request: Record<string, string>, action: string, ref: string): Record<string, unknown> => {
    let r = run('powershell.exe', args, JSON.stringify(request));
    // Windows PowerShell ships with Windows; pwsh is the fallback where it was removed.
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') r = run('pwsh', args, JSON.stringify(request));
    if (r.error || r.status !== 0) throw failed(name, action, ref, r);
    try {
      return JSON.parse(r.stdout.trim() || '{}') as Record<string, unknown>;
    } catch {
      throw failed(name, action, ref, { ...r, stderr: 'unexpected output from PowerShell' });
    }
  };
  const target = (ref: string) => `${SERVICE}:${ref}`;
  return {
    name,
    get(ref) {
      checkRef(ref);
      const secret = invoke({ op: 'get', target: target(ref) }, 'read', ref).secret;
      return typeof secret === 'string' ? secret : undefined;
    },
    set(ref, secret) {
      checkRef(ref);
      checkSecret(secret);
      invoke({ op: 'set', target: target(ref), user: ref, secret }, 'store', ref);
    },
    delete(ref) {
      checkRef(ref);
      return invoke({ op: 'delete', target: target(ref) }, 'delete', ref).deleted === true;
    },
  };
}

function linux(run: Spawner): SecretStore {
  const name = 'Secret Service (secret-tool)';
  const attrs = (ref: string) => ['service', SERVICE, 'account', ref];
  return {
    name,
    get(ref) {
      checkRef(ref);
      const r = run('secret-tool', ['lookup', ...attrs(ref)], '');
      if (r.error) throw failed(name, 'read', ref, r);
      // secret-tool exits 1 with no output when nothing matches.
      if (r.status !== 0) {
        if (r.stderr.trim() === '') return undefined;
        throw failed(name, 'read', ref, r);
      }
      return r.stdout.replace(/\r?\n$/, '');
    },
    set(ref, secret) {
      checkRef(ref);
      checkSecret(secret);
      // secret-tool store reads the secret from stdin when it isn't a terminal.
      const r = run('secret-tool', ['store', `--label=toil ${ref}`, ...attrs(ref)], secret);
      if (r.error || r.status !== 0) throw failed(name, 'store', ref, r);
    },
    delete(ref) {
      if (this.get(ref) === undefined) return false;
      const r = run('secret-tool', ['clear', ...attrs(ref)], '');
      if (r.error || r.status !== 0) throw failed(name, 'delete', ref, r);
      return true;
    },
  };
}

function none(platform: string): SecretStore {
  const refuse = (ref: string): never => {
    throw unavailable('none', ref, `toil has no credential store for ${platform}.`);
  };
  return { name: 'none', get: refuse, set: refuse, delete: refuse };
}

/** The store for this platform. Only `src/core/keychain.ts` spawns; everything else goes through this. */
export function createSecretStore(options: { platform?: NodeJS.Platform; spawn?: Spawner } = {}): SecretStore {
  const platform = options.platform ?? process.platform;
  const run = options.spawn ?? spawnProgram;
  if (platform === 'darwin') return macos(run);
  if (platform === 'win32') return windows(run);
  if (platform === 'linux') return linux(run);
  return none(platform);
}

/**
 * Stores a secret and reads it back. Callers point config at the reference
 * only after this returns, so a store that quietly drops a write can never
 * leave config naming an entry that isn't there.
 */
export function storeVerified(store: SecretStore, ref: string, secret: string): void {
  store.set(ref, secret);
  if (store.get(ref) !== secret) {
    throw new ToilError('CREDENTIAL_STORE', `${store.name} accepted "${ref}" but reading it back didn't return the same secret. Config was not changed.`, {
      fix: 'Try again, or set the secret with an env var instead.',
    });
  }
}

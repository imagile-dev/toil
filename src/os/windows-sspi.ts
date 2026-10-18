import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ToilError } from '../core/errors.js';

/**
 * Windows authentication's handshake, from the logon session Windows already
 * holds. Node has no SSPI binding, and a native addon is out of the question
 * (No Executables), so this runs one Windows PowerShell per connection, which
 * calls secur32's Negotiate package (Kerberos, falling back to NTLM) through
 * Add-Type. It is the only module besides the credential store and git that
 * may spawn, and only programs Windows ships (CLAUDE.md, No Executables).
 *
 * Everything travels on stdin and stdout, never argv: the script, then one
 * JSON request (the SPN, and for another account its domain, user and
 * password), then each token from the server as one base64 line. The helper
 * answers each with `TOKEN <base64>`, or `ERR <kind> <message>`. Nothing is
 * written until the helper has said READY, because Windows PowerShell reads
 * its commands from the same stdin and would otherwise swallow the request.
 *
 * Asking Windows for a ticket it already issued is the rare request that
 * needs no further approval, which is why nobody here is filling one in.
 */

/** One handshake: the first token for the server, then one answer per token the server sends back. */
export interface SspiExchange {
  /** The token for the login packet. */
  readonly first: Buffer;
  /** The answer to a token from the server; empty when the client has nothing more to say. */
  next(serverToken: Buffer): Promise<Buffer>;
  /** Ends the helper. Safe to call more than once. */
  close(): void;
}

export interface SspiRequest {
  /** The service principal name, `MSSQLSvc/<host>:<port>`. */
  spn: string;
  /** Another account to sign in as; omitted, the current Windows user. */
  account?: { domain?: string; user: string; password: string };
}

/** Runs the helper. Tests replace it; the real one is the only spawn here. */
export type HelperSpawner = (env: NodeJS.ProcessEnv) => { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; kill: () => void; on: (event: 'exit', listener: (code: number | null) => void) => void };

/**
 * Windows PowerShell 5.1, by absolute path under the system root, so a
 * `powershell.exe` earlier on PATH is never the one that gets the password.
 */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** The caller's env, cut to what PowerShell and Add-Type's compiler need. No toil secret rides along. */
const PASS_ENV = ['SystemRoot', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'PATHEXT', 'PSModulePath', 'ComSpec', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'];

export function helperEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(PASS_ENV.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

const spawnHelper: HelperSpawner = (env) =>
  spawn(powershellPath(env), ['-NoProfile', '-NonInteractive', '-Command', '-'], { shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });

/**
 * The secur32 calls. Credentials are acquired once; each step feeds the
 * server's token in and returns the next one, completing the token when the
 * package asks. ISC_REQ_CONNECTION only: no mutual authentication, so the
 * server needs nothing back after its login acknowledgement.
 */
export const SSPI_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public sealed class ToilSspi {
  [StructLayout(LayoutKind.Sequential)] private struct SecHandle { public IntPtr Lower; public IntPtr Upper; }
  [StructLayout(LayoutKind.Sequential)] private struct SecBuffer { public int cbBuffer; public int BufferType; public IntPtr pvBuffer; }
  [StructLayout(LayoutKind.Sequential)] private struct SecBufferDesc { public int ulVersion; public int cBuffers; public IntPtr pBuffers; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct AuthIdentity {
    public string User; public int UserLength; public string Domain; public int DomainLength; public string Password; public int PasswordLength; public int Flags;
  }
  [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
  private static extern int AcquireCredentialsHandleW(string principal, string package, int credentialUse, IntPtr logonId, IntPtr authData, IntPtr getKeyFn, IntPtr getKeyArgument, ref SecHandle credential, out long expiry);
  [DllImport("secur32.dll", CharSet = CharSet.Unicode, EntryPoint = "InitializeSecurityContextW")]
  private static extern int InitFirst(ref SecHandle credential, IntPtr context, string target, int flags, int reserved1, int dataRep, IntPtr input, int reserved2, ref SecHandle newContext, ref SecBufferDesc output, out int attributes, out long expiry);
  [DllImport("secur32.dll", CharSet = CharSet.Unicode, EntryPoint = "InitializeSecurityContextW")]
  private static extern int InitNext(ref SecHandle credential, ref SecHandle context, string target, int flags, int reserved1, int dataRep, ref SecBufferDesc input, int reserved2, ref SecHandle newContext, ref SecBufferDesc output, out int attributes, out long expiry);
  [DllImport("secur32.dll")] private static extern int CompleteAuthToken(ref SecHandle context, ref SecBufferDesc token);
  [DllImport("secur32.dll")] private static extern int DeleteSecurityContext(ref SecHandle context);
  [DllImport("secur32.dll")] private static extern int FreeCredentialsHandle(ref SecHandle credential);

  private const int Outbound = 2, NativeDataRep = 0x10, TokenBuffer = 2, MaxToken = 65536, RequestConnection = 0x800;
  private const int Ok = 0, ContinueNeeded = 0x00090312, CompleteNeeded = 0x00090313, CompleteAndContinue = 0x00090314;
  private SecHandle credential, context;
  private bool started;
  private readonly string spn;

  public ToilSspi(string spn, string domain, string user, string password) {
    this.spn = spn;
    IntPtr identity = IntPtr.Zero;
    try {
      if (!String.IsNullOrEmpty(user)) {
        AuthIdentity id = new AuthIdentity();
        id.User = user; id.UserLength = user.Length;
        id.Domain = domain ?? ""; id.DomainLength = id.Domain.Length;
        id.Password = password ?? ""; id.PasswordLength = id.Password.Length;
        id.Flags = 2;
        identity = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(AuthIdentity)));
        Marshal.StructureToPtr(id, identity, false);
      }
      long expiry;
      int status = AcquireCredentialsHandleW(null, "Negotiate", Outbound, IntPtr.Zero, identity, IntPtr.Zero, IntPtr.Zero, ref credential, out expiry);
      if (status != Ok) throw new Exception(String.Format("AcquireCredentialsHandle failed: 0x{0:X8}", status));
    } finally {
      if (identity != IntPtr.Zero) { Marshal.DestroyStructure(identity, typeof(AuthIdentity)); Marshal.FreeHGlobal(identity); }
    }
  }

  private static SecBufferDesc Describe(IntPtr buffer) { SecBufferDesc d = new SecBufferDesc(); d.ulVersion = 0; d.cBuffers = 1; d.pBuffers = buffer; return d; }

  public byte[] Step(byte[] input) {
    IntPtr outBuffer = Marshal.AllocHGlobal(MaxToken);
    IntPtr outDescriptor = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecBuffer)));
    IntPtr inBuffer = IntPtr.Zero, inDescriptor = IntPtr.Zero;
    try {
      SecBuffer o = new SecBuffer(); o.cbBuffer = MaxToken; o.BufferType = TokenBuffer; o.pvBuffer = outBuffer;
      Marshal.StructureToPtr(o, outDescriptor, false);
      SecBufferDesc output = Describe(outDescriptor);
      int attributes; long expiry; int status;
      if (!started) {
        status = InitFirst(ref credential, IntPtr.Zero, spn, RequestConnection, 0, NativeDataRep, IntPtr.Zero, 0, ref context, ref output, out attributes, out expiry);
        started = true;
      } else {
        inBuffer = Marshal.AllocHGlobal(input.Length);
        Marshal.Copy(input, 0, inBuffer, input.Length);
        inDescriptor = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecBuffer)));
        SecBuffer i = new SecBuffer(); i.cbBuffer = input.Length; i.BufferType = TokenBuffer; i.pvBuffer = inBuffer;
        Marshal.StructureToPtr(i, inDescriptor, false);
        SecBufferDesc inputDesc = Describe(inDescriptor);
        status = InitNext(ref credential, ref context, spn, RequestConnection, 0, NativeDataRep, ref inputDesc, 0, ref context, ref output, out attributes, out expiry);
      }
      if (status == CompleteNeeded || status == CompleteAndContinue) {
        int completed = CompleteAuthToken(ref context, ref output);
        if (completed != Ok) throw new Exception(String.Format("CompleteAuthToken failed: 0x{0:X8}", completed));
      } else if (status != Ok && status != ContinueNeeded) {
        throw new Exception(String.Format("InitializeSecurityContext failed for {0}: 0x{1:X8}", spn, status));
      }
      SecBuffer written = (SecBuffer)Marshal.PtrToStructure(outDescriptor, typeof(SecBuffer));
      byte[] token = new byte[written.cbBuffer];
      if (written.cbBuffer > 0) Marshal.Copy(outBuffer, token, 0, written.cbBuffer);
      return token;
    } finally {
      Marshal.FreeHGlobal(outBuffer); Marshal.FreeHGlobal(outDescriptor);
      if (inBuffer != IntPtr.Zero) Marshal.FreeHGlobal(inBuffer);
      if (inDescriptor != IntPtr.Zero) Marshal.FreeHGlobal(inDescriptor);
    }
  }

  public void Close() { if (started) DeleteSecurityContext(ref context); FreeCredentialsHandle(ref credential); }
}
`;

/** The helper's script, run once READY is out of the way. Reads the request, then one server token per line. */
export const HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
try { Add-Type -TypeDefinition $source } catch { [Console]::Out.WriteLine('ERR ADDTYPE ' + ($_.Exception.Message -replace '\s+', ' ')); exit 4 }
[Console]::Out.WriteLine('READY')
$sspi = $null
try {
  $req = [Console]::In.ReadLine() | ConvertFrom-Json
  $sspi = New-Object ToilSspi($req.spn, $req.domain, $req.user, $req.password)
  $req = $null
  [Console]::Out.WriteLine('TOKEN ' + [Convert]::ToBase64String($sspi.Step($null)))
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null -or $line -eq 'END') { break }
    [Console]::Out.WriteLine('TOKEN ' + [Convert]::ToBase64String($sspi.Step([Convert]::FromBase64String($line))))
  }
} catch {
  # A .NET exception thrown inside a method call arrives wrapped; the inner one says what SSPI said.
  $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
  [Console]::Out.WriteLine('ERR SSPI ' + ($e.Message -replace '\s+', ' '))
  exit 1
} finally {
  if ($sspi -ne $null) { $sspi.Close() }
}
`;

/**
 * The one line Windows PowerShell reads as a command. It refuses to go on
 * in Constrained Language Mode, where Add-Type is blocked, before touching
 * anything a lockdown would refuse; otherwise it decodes the script and the
 * C# source it carries and runs them. Both are constants of this module.
 */
export function bootstrapLine(): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  return (
    "if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Write-Output ('ERR CLM ' + $ExecutionContext.SessionState.LanguageMode); exit 3 }; " +
    `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(SSPI_SOURCE)}')); ` +
    `& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(HELPER_SCRIPT)}'))))`
  );
}

/** The error for a platform that has no SSPI to ask. */
export function notWindows(connection: string): ToilError {
  return new ToilError('CONFIG_INVALID', `Connection ${connection} uses "auth": "windows", which works only on Windows; this is ${process.platform}.`, {
    fix: `Sign in with a SQL Server login instead: remove "auth" (or set it to "sql") and set "user" and "password" on connection ${connection}.`,
  });
}

function failure(connection: string, kind: string, detail: string): ToilError {
  if (kind === 'CLM') {
    return new ToilError('AUTH', `Windows authentication for connection ${connection} needs Windows PowerShell in Full Language mode, and this machine runs it in ${detail || 'Constrained Language mode'} (an AppLocker or WDAC policy).`, {
      fix: `Ask whoever manages the policy to allow it, or sign in with a SQL Server login: remove "auth" and set "user" and "password" on connection ${connection}.`,
    });
  }
  if (kind === 'ADDTYPE') {
    return new ToilError('AUTH', `Windows authentication for connection ${connection} couldn't load its SSPI helper: ${detail}`, {
      fix: `Windows PowerShell compiles the helper with Add-Type, which needs a writable TEMP folder and must not be blocked by policy. Or sign in with a SQL Server login on connection ${connection}.`,
    });
  }
  return new ToilError('AUTH', `Windows refused the sign-in for connection ${connection}: ${detail}`, {
    fix: `Check that this Windows user (or the domain account set on connection ${connection}) can reach a domain controller, and that the server's SPN is registered for its service account. toil connections login ${connection} stores another account's password.`,
  });
}

/**
 * Starts a handshake for one connection: spawns the helper, waits for READY,
 * sends the request and returns the first token. The helper exits when the
 * exchange closes, the signal aborts, or it fails.
 */
export async function startSspi(connection: string, request: SspiRequest, signal: AbortSignal, spawner: HelperSpawner = spawnHelper, platform: NodeJS.Platform = process.platform): Promise<SspiExchange> {
  if (platform !== 'win32') throw notWindows(connection);
  signal.throwIfAborted();
  const child = spawner(helperEnv());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()).length > 4000 && (stderr = stderr.slice(-4000)));
  // An EPIPE after the helper exits is reported through the next read, not as a crash.
  (child.stdin as NodeJS.WritableStream & { on: (e: 'error', l: () => void) => void }).on('error', () => {});
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', close);
    try {
      child.stdin.end('END\n');
    } catch {
      // Already gone.
    }
    child.kill();
  };
  signal.addEventListener('abort', close, { once: true });

  const read = async (): Promise<string> => {
    const { value, done } = await lines.next();
    if (done || value === undefined) throw failure(connection, 'SSPI', `the helper stopped without answering${stderr.trim() ? ` (${stderr.trim().split(/\r?\n/)[0]})` : ''}`);
    const [tag, kind, ...rest] = value.trim().split(' ');
    if (tag === 'ERR') throw failure(connection, kind ?? 'SSPI', rest.join(' '));
    return value.trim();
  };
  const token = async (): Promise<Buffer> => {
    const line = await read();
    if (!line.startsWith('TOKEN')) throw failure(connection, 'SSPI', 'the helper answered out of turn');
    return Buffer.from(line.slice('TOKEN'.length).trim(), 'base64');
  };

  try {
    child.stdin.write(bootstrapLine() + '\n');
    if ((await read()) !== 'READY') throw failure(connection, 'SSPI', 'the helper answered out of turn');
    const { account } = request;
    child.stdin.write(JSON.stringify({ spn: request.spn, domain: account?.domain ?? null, user: account?.user ?? null, password: account?.password ?? null }) + '\n');
    const first = await token();
    return {
      first,
      async next(serverToken) {
        if (closed) throw failure(connection, 'SSPI', 'the handshake was already closed');
        child.stdin.write(serverToken.toString('base64') + '\n');
        return token();
      },
      close,
    };
  } catch (err) {
    close();
    if (signal.aborted) throw signal.reason;
    throw err;
  }
}

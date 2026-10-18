import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { powershellPath } from '../../src/os/windows-sspi.js';

/**
 * The server half of an SSPI handshake, for Windows-only tests: Windows
 * PowerShell calling AcceptSecurityContext on the Negotiate package, so the
 * helper's tokens can be checked by the same SSPI a SQL Server would use,
 * without a domain or a server. Test tooling; never shipped.
 */
const SERVER_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public sealed class ToilSspiServer {
  [StructLayout(LayoutKind.Sequential)] private struct SecHandle { public IntPtr Lower; public IntPtr Upper; }
  [StructLayout(LayoutKind.Sequential)] private struct SecBuffer { public int cbBuffer; public int BufferType; public IntPtr pvBuffer; }
  [StructLayout(LayoutKind.Sequential)] private struct SecBufferDesc { public int ulVersion; public int cBuffers; public IntPtr pBuffers; }
  [DllImport("secur32.dll", CharSet = CharSet.Unicode)]
  private static extern int AcquireCredentialsHandleW(string principal, string package, int credentialUse, IntPtr logonId, IntPtr authData, IntPtr getKeyFn, IntPtr getKeyArgument, ref SecHandle credential, out long expiry);
  [DllImport("secur32.dll", EntryPoint = "AcceptSecurityContext")]
  private static extern int AcceptFirst(ref SecHandle credential, IntPtr context, ref SecBufferDesc input, int flags, int dataRep, ref SecHandle newContext, ref SecBufferDesc output, out int attributes, out long expiry);
  [DllImport("secur32.dll", EntryPoint = "AcceptSecurityContext")]
  private static extern int AcceptNext(ref SecHandle credential, ref SecHandle context, ref SecBufferDesc input, int flags, int dataRep, ref SecHandle newContext, ref SecBufferDesc output, out int attributes, out long expiry);
  [DllImport("secur32.dll", CharSet = CharSet.Unicode)] private static extern int QueryContextAttributesW(ref SecHandle context, int attribute, out IntPtr buffer);
  private SecHandle credential, context;
  private bool started;
  public int Status;
  public ToilSspiServer() {
    long expiry;
    int s = AcquireCredentialsHandleW(null, "Negotiate", 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, ref credential, out expiry);
    if (s != 0) throw new Exception(String.Format("AcquireCredentialsHandle: 0x{0:X8}", s));
  }
  private static IntPtr Buffer(byte[] data, int size, out IntPtr memory) {
    memory = Marshal.AllocHGlobal(size);
    if (data != null) Marshal.Copy(data, 0, memory, data.Length);
    SecBuffer b = new SecBuffer(); b.cbBuffer = data != null ? data.Length : size; b.BufferType = 2; b.pvBuffer = memory;
    IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecBuffer)));
    Marshal.StructureToPtr(b, p, false);
    return p;
  }
  public byte[] Accept(byte[] token) {
    IntPtr inMem, outMem;
    IntPtr inBuf = Buffer(token, token.Length, out inMem), outBuf = Buffer(null, 65536, out outMem);
    SecBufferDesc input = new SecBufferDesc(); input.cBuffers = 1; input.pBuffers = inBuf;
    SecBufferDesc output = new SecBufferDesc(); output.cBuffers = 1; output.pBuffers = outBuf;
    int attributes; long expiry;
    Status = started ? AcceptNext(ref credential, ref context, ref input, 0, 0x10, ref context, ref output, out attributes, out expiry)
                     : AcceptFirst(ref credential, IntPtr.Zero, ref input, 0, 0x10, ref context, ref output, out attributes, out expiry);
    started = true;
    SecBuffer written = (SecBuffer)Marshal.PtrToStructure(outBuf, typeof(SecBuffer));
    byte[] result = new byte[written.cbBuffer];
    if (written.cbBuffer > 0) Marshal.Copy(outMem, result, 0, written.cbBuffer);
    Marshal.FreeHGlobal(inMem); Marshal.FreeHGlobal(outMem); Marshal.FreeHGlobal(inBuf); Marshal.FreeHGlobal(outBuf);
    return result;
  }
  public string User() {
    IntPtr names;
    int s = QueryContextAttributesW(ref context, 1, out names);
    if (s != 0) return null;
    // SecPkgContext_Names is one pointer, so the out value is the name itself.
    return Marshal.PtrToStringUni(names);
  }
}
`;

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition $source
$server = New-Object ToilSspiServer
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'END') { break }
  $out = $server.Accept([Convert]::FromBase64String($line))
  $user = if ($server.Status -eq 0) { $server.User() } else { '' }
  [Console]::Out.WriteLine(('{0} {1} {2}' -f $server.Status, [Convert]::ToBase64String($out), $user))
}
`;

export interface SspiServer {
  /** Feeds a client token; returns the SSPI status, the server's answer, and the signed-in user once complete. */
  accept(token: Buffer): Promise<{ status: number; token: Buffer; user: string }>;
  close(): void;
}

export async function startSspiServer(): Promise<SspiServer> {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const child = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    const { value, done } = await lines.next();
    if (done) throw new Error('the test SSPI server stopped');
    return value.trim();
  };
  child.stdin.write(
    `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(SERVER_SOURCE)}')); & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(SCRIPT)}'))))\n`,
  );
  if ((await next()) !== 'READY') throw new Error('the test SSPI server did not start');
  return {
    async accept(token) {
      child.stdin.write(token.toString('base64') + '\n');
      const [status, out, ...user] = (await next()).split(' ');
      return { status: Number(status), token: Buffer.from(out ?? '', 'base64'), user: user.join(' ') };
    },
    close() {
      child.stdin.end('END\n');
      child.kill();
    },
  };
}

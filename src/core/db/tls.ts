import { X509Certificate } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { connect as netConnect, isIP, Socket } from 'node:net';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import * as tls from 'node:tls';
import { ToilError } from '../errors.js';
import { nodeFiles } from '../files.js';
import { remotePathKind } from '../local-path.js';
import type { DbProvider, DbSettings } from './provider.js';

/**
 * The two TLS settings a database connection has beyond `ssl`, both of which
 * only ever add to what verification accepts and never switch any of it off.
 *
 * `tlsServerName`: reach a server at `host` while its certificate names
 * something else (a VPN alias, a tunnel, a proxy's canonical name). The socket
 * still goes only to `host`; the handshake sends the name as SNI and the
 * certificate is verified in full, chain and name, against it. A certificate
 * that doesn't name it fails exactly as it would for `host`. The host names
 * were never the problem; the paperwork that renames them is.
 *
 * `tlsCaFile`: a PEM file of CA certificates added to the connection's trust
 * for this connection only (an organization's or a cloud's CA, such as
 * Amazon's RDS bundle). It is read here with node:fs because the person named
 * it in their own config, not a call (docs/bounds.md, `db.tls-ca-file`).
 */

type TlsKey = 'tlsServerName' | 'tlsCaFile';

const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Why this is not a DNS host name a certificate could carry, or undefined when it is one. */
export function badTlsServerName(name: string): string | undefined {
  if (name.length > 253) return 'is longer than a DNS name can be (253 characters)';
  if (isIP(name) !== 0 || /^\[.*\]$/.test(name)) return 'is an IP address; a certificate is checked against a host name (use "host" for an address)';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(name)) return 'looks like a URL; give the host name only';
  if (/[\s/:@?#]/.test(name)) return 'must be a bare host name, with no spaces, scheme, port, path or user';
  if (name.startsWith('*')) return 'is a wildcard; give the exact name the server will be verified against';
  if (!name.split('.').every((label) => LABEL.test(label))) return 'must be a DNS host name: letters, digits and hyphens, separated by dots';
  return undefined;
}

/**
 * Why `path` isn't an absolute local path on `platform`, or undefined when it is. On Windows
 * that means a drive letter: `/etc/x.pem` and `\\certs\\x.pem` are "absolute" to Node but
 * resolve against whichever drive the process happens to be on (principle 8). A network
 * (UNC) or device path is refused from its text alone, before any file call, because on
 * Windows even a stat of one opens a connection to that host (bound `files.remote`).
 */
export function badCaFilePath(path: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const kind = remotePathKind(path);
  if (kind === 'device') return 'is a Windows device path; toil reads only ordinary files. Point it at a PEM file on a local disk';
  if (kind === 'unc') return "is a network (UNC) path, and toil doesn't open files on other machines. Copy the PEM file to a local disk and point at that copy";
  if (platform === 'win32') {
    if (win32.isAbsolute(path) && !/^[A-Za-z]:[\\/]/.test(path)) return 'starts at the root of whichever drive is current, which differs from one run to the next. Give the drive letter, such as C:\\certs\\global-bundle.pem (or C:/certs/global-bundle.pem in JSON)';
    if (!win32.isAbsolute(path)) return "must be an absolute path with a drive letter, such as C:\\certs\\global-bundle.pem (toil doesn't expand \"~\" or resolve relative paths)";
    return undefined;
  }
  if (!posix.isAbsolute(path)) return "must be an absolute path starting with /, such as /etc/ssl/rds/global-bundle.pem (toil doesn't expand \"~\" or resolve relative paths)";
  return undefined;
}

/**
 * The rules both settings share, for every engine in one place: they need
 * `"ssl": true`, only some engines can honour them, and each has its own shape.
 * The file itself is read later, when a call connects (`caFileCertificates`),
 * so a missing file never breaks listing or removing the connection.
 */
export function tlsIssues(settings: Partial<DbSettings>, provider: DbProvider | undefined, all: readonly DbProvider[]): Array<{ key: TlsKey; message: string }> {
  const issues: Array<{ key: TlsKey; message: string }> = [];
  for (const key of ['tlsServerName', 'tlsCaFile'] as const) {
    const value = settings[key];
    if (value === undefined) continue;
    if (!provider?.tlsSettings?.includes(key)) {
      const engines = all.filter((p) => p.tlsSettings?.includes(key)).map((p) => p.engine);
      issues.push({ key, message: `"${key}" isn't supported for ${provider?.label ?? 'this engine'}. It works with the ${engines.join(', ')} engines.` });
    } else if (settings.ssl !== true) {
      issues.push({ key, message: `"${key}" only applies to a TLS connection. Set "ssl": true on this connection, or remove "${key}".` });
    } else if (key === 'tlsServerName') {
      const bad = badTlsServerName(value);
      if (bad) issues.push({ key, message: `"tlsServerName" ${bad}. Set it to the host name on the server's certificate, such as db.imagile.dev.` });
    } else {
      const bad = badCaFilePath(value);
      if (bad) issues.push({ key, message: `"tlsCaFile" ${bad}.` });
    }
  }
  return issues;
}

const CA_FILE_MAX_BYTES = 1024 * 1024;
const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * The certificates in `tlsCaFile`, or CONFIG_INVALID naming the file and never quoting it.
 * The path goes through the same bounds as any file a command reads, except the workspace: no
 * network or device path, nothing under toil's own config (`~/.toil`, the --config file
 * in `protect`) or /proc and /sys, compared after realpath. It is then opened and read
 * through the descriptor, capped, so a pipe or device that reports size 0 can't be read
 * without limit.
 */
export function caFileCertificates(conn: { name: string; tlsCaFile?: string }, protect: readonly string[] = []): string[] {
  const path = conn.tlsCaFile;
  if (path === undefined) return [];
  const refuse = (what: string, fix: string) => new ToilError('CONFIG_INVALID', `"tlsCaFile" on connection ${conn.name}, ${path}, ${what}.`, { fix });
  const notRegular = () => refuse('is not a regular file', 'Point "tlsCaFile" at a PEM file, not a folder, pipe or device.');
  const bad = badCaFilePath(path);
  if (bad) throw refuse(bad, 'Give "tlsCaFile" an absolute local path to a PEM file.');
  const files = nodeFiles({ cwd: join(path, '..'), stdin: false, unbounded: true, protect: [join(homedir(), '.toil'), ...protect] });
  let text: string;
  try {
    // The bounds' own refusals (own config, /proc, /sys, network and device paths), as CONFIG_INVALID.
    const kind = files.stat(path).type;
    if (kind !== 'file') throw notRegular();
    const fd = openSync(path, 'r');
    try {
      if (!fstatSync(fd).isFile()) throw notRegular();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, CA_FILE_MAX_BYTES + 1 - total));
        const n = readSync(fd, chunk, 0, chunk.length, null);
        if (n === 0) break;
        chunks.push(chunk.subarray(0, n));
        total += n;
        if (total > CA_FILE_MAX_BYTES) throw refuse('is over the 1 MB limit for a CA file', "Point \"tlsCaFile\" at a PEM file holding only CA certificates (Amazon's global bundle is about 160 KB).");
      }
      text = Buffer.concat(chunks).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    if (err instanceof ToilError && err.code === 'CONFIG_INVALID') throw err;
    if (err instanceof ToilError && err.code === 'INVALID_INPUT') throw refuse(`can't be used: ${err.message.replace(/^"[^"]*" /, '').replace(/\.$/, '')}`, err.fix ?? 'Point "tlsCaFile" at an ordinary PEM file.');
    throw refuse(`can't be read (${(err as NodeJS.ErrnoException).code ?? 'error'})`, `Check that the file exists and that this user can read it, or remove "tlsCaFile" from connection ${conn.name}.`);
  }
  const blocks = text.match(PEM_BLOCK) ?? [];
  if (blocks.length === 0) throw refuse('has no "-----BEGIN CERTIFICATE-----" block', 'Point "tlsCaFile" at a PEM file of CA certificates. A DER or .p7b file must be converted to PEM first.');
  for (const [index, block] of blocks.entries()) {
    try {
      new X509Certificate(block);
    } catch {
      throw refuse(`holds a certificate Node can't parse (number ${index + 1})`, 'Re-download the file, or point "tlsCaFile" at a PEM file of valid CA certificates.');
    }
  }
  return blocks;
}

/**
 * What this connection trusts: `base` (core's list, or undefined when the OS
 * store couldn't be read) plus the CA file's certificates. Nothing replaces
 * the chain or the name check; the file only adds anchors, for this
 * connection's socket alone.
 */
export function trustWithCaFile(conn: { name: string; tlsCaFile?: string }, base: string[] | undefined, debug: (message: string) => void, protect: readonly string[] = []): string[] | undefined {
  if (conn.tlsCaFile === undefined) return base;
  const extra = caFileCertificates(conn, protect);
  debug(`${conn.name}: TLS, trusting ${extra.length} certificate(s) from ${conn.tlsCaFile}`);
  return [...(base ?? tls.getCACertificates('default')), ...extra];
}

/**
 * A TCP socket to the real host, for a driver that derives both SNI and the
 * certificate check from the `host` it is given: that is set to the TLS name,
 * and the driver's stream option hands it this socket instead of letting it
 * resolve the name.
 */
export function socketTo(host: string, port: number): Socket {
  const socket = netConnect(port, host);
  socket.setNoDelay(true);
  return socket;
}

/**
 * The same, for a driver that makes its own socket and then calls
 * `connect(port, <TLS name>)` on it (pg): the call is accepted and connects to
 * the real host instead, so the name is never resolved.
 */
export function socketToOnConnect(host: string, port: number): Socket {
  const socket = new Socket();
  const connect = socket.connect.bind(socket) as (port: number, host: string) => Socket;
  socket.connect = (() => connect(port, host)) as unknown as typeof socket.connect;
  return socket;
}

/** How a connection's TLS is named in debug lines, so an override is never invisible (the CA file is reported by trustWithCaFile, with its count). */
export function tlsLabel(conn: { tlsServerName?: string }): string {
  return conn.tlsServerName ? `TLS, verifying ${conn.tlsServerName}` : 'TLS';
}

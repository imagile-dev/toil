import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { connect as netConnect, isIP, Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import * as tls from 'node:tls';
import { ToilError } from '../errors.js';
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
    } else if (!isAbsolute(value)) {
      issues.push({ key, message: `"tlsCaFile" must be an absolute path to a PEM file (toil doesn't expand "~" or resolve relative paths). Set it to something like /etc/ssl/certs/global-bundle.pem or C:\\certs\\global-bundle.pem.` });
    }
  }
  return issues;
}

const CA_FILE_MAX_BYTES = 1024 * 1024;
const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** The certificates in `tlsCaFile`, or CONFIG_INVALID naming the file and never quoting it. */
export function caFileCertificates(conn: { name: string; tlsCaFile?: string }): string[] {
  const path = conn.tlsCaFile;
  if (path === undefined) return [];
  const refuse = (what: string, fix: string) => new ToilError('CONFIG_INVALID', `"tlsCaFile" on connection ${conn.name}, ${path}, ${what}.`, { fix });
  let text: string;
  try {
    const size = statSync(path).size;
    if (size > CA_FILE_MAX_BYTES) throw refuse(`is ${size} bytes, over the 1 MB limit for a CA file`, "Point \"tlsCaFile\" at a PEM file holding only CA certificates (Amazon's global bundle is about 160 KB).");
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err instanceof ToilError) throw err;
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
export function trustWithCaFile(conn: { name: string; tlsCaFile?: string }, base: string[] | undefined, debug: (message: string) => void): string[] | undefined {
  if (conn.tlsCaFile === undefined) return base;
  const extra = caFileCertificates(conn);
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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ConnectionParameters from 'pg/lib/connection-parameters.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { area } from '../../src/areas/db/index.js';
import { tlsOptions } from '../../src/core/db/hive/hs2.js';
import { connectionOptions, toToilError } from '../../src/core/db/mysql/index.js';
import { clientConfig } from '../../src/core/db/postgres/index.js';
import type { DbConnection } from '../../src/core/db/provider.js';
import { connectionConfig } from '../../src/core/db/sqlserver/index.js';
import { badCaFilePath, badTlsServerName, caFileCertificates, tlsLabel, trustWithCaFile } from '../../src/core/db/tls.js';
import type { NetworkApis } from '../../src/core/network.js';

/**
 * tlsServerName and tlsCaFile: what each driver is handed, and the refusals.
 * The handshakes themselves were run against real servers (the PR shows
 * them); here the options each driver receives are held in place, and the
 * redirecting sockets are proved against a loopback listener.
 */

// A throwaway CA, made for these tests with openssl and trusted by nothing.
const CA = `-----BEGIN CERTIFICATE-----
MIIDDzCCAfegAwIBAgIUfIRkho8r7fPRcO37MwFat1p5GRQwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMVG9pbCBUZXN0IENBMB4XDTI2MTAyOTExNTQwMVoXDTI2
MTEyODExNTQwMVowFzEVMBMGA1UEAwwMVG9pbCBUZXN0IENBMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxHnGy9aT3Jd/eV9HUPsONEUEmVZNL+gajiPu
WIZ+L4wCbOaSm8a3t73kXIV/b0GPgRmAxyN+516hl60ttogyB1eaO5yEhhiuVbuc
ewDt9v+hKMwGFRKJosvpU7YAtKkVrjH5Q7NdACShSzVNCzCkbHGERopA462ruG5c
vpMPCSZuOpIVcBVjnux89XMdQWqrB7iDjJHebtvmQKV6MotmTyNtyTtlF98aDIHL
86BHaHssU4Y7xr2VCRyfcNRleOxFTn6rLYayDOsrI+PpYZB6IfT4yr5XQh/FZMXd
wCXDFM3rb98T9BURswdRtgc51+IWe3bo5ZeoZctD59j+6D14sQIDAQABo1MwUTAd
BgNVHQ4EFgQUvwRFfLbBAkoJEFNulszU9NLsFrgwHwYDVR0jBBgwFoAUvwRFfLbB
AkoJEFNulszU9NLsFrgwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOC
AQEAcED6R78d18fTTANdpWutWzpCUb7tLmg4uAuq4dkML2dpCQba6t+0+bP1sfng
Yl9qRWWrSueP/VWMKEn56vlImiGAla6MK07pIr2Siom6E4X+GAcrtuLy9UYiqFWs
+azYR01EVttC801TvAPcZbZIBF3wtTxeqiqRS7GlyidCdreJperpNd+viyJdldlT
q5Cwoco7ZJ9xXxLVMw6MvlnQ947HqgH3RDEpCmUrX6neb31xUZ/sNH2mwUuHlhbK
V5s/0KL72l5DUk5IvhJlE8eJnqWT0YOzwz7DYpnJflqQsKUugIgZ8V41FnGoy/Yf
NJGZCQ0FPn3fD8IIawlCVxt8zw==
-----END CERTIFICATE-----`;

const apis = (system: string[]): NetworkApis => ({
  getCACertificates: ((type?: string) => (type === 'system' ? system : ['BUNDLED-1'])) as NetworkApis['getCACertificates'],
  setDefaultCACertificates: () => {},
  setGlobalProxyFromEnv: () => () => {},
});

const base = { name: 'db', area: 'db', host: '127.0.0.1', database: 'app', user: 'reader', password: 'x', ssl: true } as const;
const conn = (engine: string, extra: object = {}) => ({ ...base, engine, ...extra }) as unknown as DbConnection;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toil-tls-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

/** The messages the db connection schema raises for these settings. */
function issues(settings: Record<string, unknown>): string[] {
  const parsed = (area.connection as unknown as { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } } }).safeParse({ host: 'db.imagile.dev', ...settings });
  return parsed.success ? [] : parsed.error!.issues.map((i) => i.message);
}

describe('tlsServerName and tlsCaFile validation', () => {
  const pg = { engine: 'postgres', database: 'app', user: 'reader' };

  it('accepts a DNS name and an absolute path with ssl on, on every engine that supports them', () => {
    const ca = join(dir, 'bundle.pem');
    for (const engine of ['postgres', 'mysql', 'sqlserver', 'hive', 'impala']) {
      expect(issues({ ...pg, engine, ssl: true, tlsServerName: 'db.imagile.dev', tlsCaFile: ca, ...(engine === 'hive' || engine === 'impala' ? { auth: 'nosasl' } : {}) }), engine).toEqual([]);
    }
  });

  it('refuses either setting without ssl, saying to set it', () => {
    expect(issues({ ...pg, tlsServerName: 'db.imagile.dev' })).toEqual([expect.stringContaining('Set "ssl": true')]);
    expect(issues({ ...pg, ssl: false, tlsCaFile: join(dir, 'x.pem') })).toEqual([expect.stringContaining('Set "ssl": true')]);
  });

  it('refuses a name that is not a bare DNS host name', () => {
    for (const bad of ['10.0.0.1', '::1', '[::1]', 'db.imagile.dev:5432', 'https://db.imagile.dev', 'db imagile', '*.imagile.dev', 'db_1.imagile.dev', 'a..b', '-a.imagile.dev', 'user@db.imagile.dev', 'db.imagile.dev/x', 'a.'.repeat(130)]) {
      expect(badTlsServerName(bad), bad).toEqual(expect.any(String));
      expect(issues({ ...pg, ssl: true, tlsServerName: bad }), bad).toHaveLength(1);
    }
    expect(badTlsServerName('db-1.eu-west-1.rds.imagile.dev')).toBeUndefined();
  });

  it('refuses a relative CA path and a "~" path, naming what to give instead', () => {
    for (const path of ['certs/bundle.pem', '~/bundle.pem']) {
      expect(issues({ ...pg, ssl: true, tlsCaFile: path }), path).toEqual([expect.stringContaining('absolute path')]);
    }
  });

  it('refuses both settings on Oracle, Teradata and SQLite, naming the engines that take them', () => {
    for (const settings of [
      { engine: 'oracle', database: 'FREEPDB1', ssl: true },
      { engine: 'teradata', baseUrl: 'https://teradata.imagile.dev', system: 's', user: 'u', password: 'p', database: 'd' },
      { engine: 'sqlite', path: join(dir, 'a.db') },
    ]) {
      for (const [key, value] of [['tlsServerName', 'db.imagile.dev'], ['tlsCaFile', join(dir, 'b.pem')]] as const) {
        expect(issues({ ...settings, [key]: value }).filter((m) => m.includes(key)), `${settings.engine} ${key}`).toEqual([expect.stringMatching(new RegExp(`"${key}" isn't supported for .*postgres, mysql, sqlserver, hive, impala`))]);
      }
    }
  });
});

describe('tlsCaFile contents', () => {
  const named = (path: string) => ({ name: 'db', tlsCaFile: path });

  it('reads every certificate in a bundle', () => {
    expect(caFileCertificates(named(file('two.pem', `${CA}\n\n${CA}\n`)))).toHaveLength(2);
  });

  it('refuses a missing file, naming the path', () => {
    const path = join(dir, 'nope.pem');
    expect(() => caFileCertificates(named(path))).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining(path) }));
  });

  it('refuses a file over 1 MB', () => {
    expect(() => caFileCertificates(named(file('big.pem', `${CA}\n${'#'.repeat(1024 * 1024)}`)))).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('1 MB') }));
  });

  it('refuses a folder and any other file that is not a regular one', () => {
    mkdirSync(join(dir, 'folder'));
    expect(() => caFileCertificates(named(join(dir, 'folder')))).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('not a regular file') }));
  });

  it("refuses toil's own files, whatever they hold, and never reads them", () => {
    const own = join(dir, 'own');
    mkdirSync(own);
    const config = join(own, 'config.json');
    writeFileSync(config, CA);
    expect(() => caFileCertificates(named(config), [own])).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining("toil's own configuration") }));
    const flagged = file('custom-config.json', CA);
    expect(() => caFileCertificates(named(flagged), [flagged])).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining("toil's own configuration") }));
  });

  it.skipIf(process.platform !== 'linux')('linux only: refuses /proc and /sys', () => {
    expect(() => caFileCertificates(named('/proc/self/environ'))).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('/proc or /sys') }));
  });

  it('refuses a network or device path before touching the disk, on every OS', () => {
    for (const path of ['\\\\fileserver\\share\\ca.pem', '//fileserver/share/ca.pem', '\\\\.\\pipe\\ca', '\\\\?\\C:\\ca.pem']) {
      expect(() => caFileCertificates(named(path)), path).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringMatching(/network \(UNC\) path|device path/) }));
      expect(issues({ engine: 'postgres', database: 'app', user: 'reader', ssl: true, tlsCaFile: path }), path).toEqual([expect.stringMatching(/network \(UNC\) path|device path/)]);
    }
  });

  it('refuses a file with no certificate, and one Node cannot parse, without quoting either', () => {
    const secret = 'PRIVATE-DETAIL-0xfeed';
    expect(() => caFileCertificates(named(file('none.pem', `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`)))).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('no "-----BEGIN CERTIFICATE-----"') }));
    const bad = file('bad.pem', `-----BEGIN CERTIFICATE-----\n${secret}\n-----END CERTIFICATE-----`);
    try {
      caFileCertificates(named(bad));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("can't parse");
      expect(JSON.stringify([(err as Error).message, (err as { fix?: string }).fix])).not.toContain(secret);
    }
  });

  it('adds to what the connection trusts and says how many, never the contents', () => {
    const path = file('ca.pem', CA);
    const said: string[] = [];
    expect(trustWithCaFile(named(path), ['BUNDLED-1', 'CORP-ROOT'], (m) => said.push(m))).toEqual(['BUNDLED-1', 'CORP-ROOT', CA]);
    expect(said).toEqual([`db: TLS, trusting 1 certificate(s) from ${path}`]);
    expect(trustWithCaFile({ name: 'db' }, ['BUNDLED-1'], () => {})).toEqual(['BUNDLED-1']);
  });
});

describe('tlsCaFile path rule, per platform', () => {
  it('on Windows, needs a drive letter and refuses a root-relative path', () => {
    expect(badCaFilePath('C:\\certs\\global-bundle.pem', 'win32')).toBeUndefined();
    expect(badCaFilePath('C:/certs/global-bundle.pem', 'win32')).toBeUndefined();
    for (const rootRelative of ['/etc/ssl/x.pem', '\\certs\\x.pem']) expect(badCaFilePath(rootRelative, 'win32'), rootRelative).toMatch(/drive letter/);
    for (const relative of ['certs\\x.pem', '~/x.pem', 'x.pem']) expect(badCaFilePath(relative, 'win32'), relative).toMatch(/drive letter/);
  });

  it('on POSIX, needs a leading slash, and a drive-letter path is relative', () => {
    expect(badCaFilePath('/etc/ssl/rds/global-bundle.pem', 'linux')).toBeUndefined();
    for (const bad of ['C:\\certs\\x.pem', 'certs/x.pem', '~/x.pem']) expect(badCaFilePath(bad, 'linux'), bad).toMatch(/absolute path starting with \//);
  });
});

describe('what each driver is handed', () => {
  const NAME = 'db.imagile.dev';
  const withName = { tlsServerName: NAME };

  it('PostgreSQL: the name as host (SNI and verification), the real host on the socket, verification untouched', async () => {
    const ca = file('ca.pem', CA);
    const config = clientConfig(conn('postgres', { ...withName, tlsCaFile: ca, port: 5999 }), () => {}, apis(['CORP-ROOT']));
    expect(config).toMatchObject({ host: NAME, port: 5999, ssl: { ca: ['BUNDLED-1', 'CORP-ROOT', CA] } });
    const parameters = new ConnectionParameters(config) as unknown as { ssl: Record<string, unknown> };
    expect(parameters.ssl.rejectUnauthorized).not.toBe(false);
    expect(parameters.ssl).not.toHaveProperty('checkServerIdentity');
    expect(parameters.ssl).not.toHaveProperty('servername');
    expect(clientConfig(conn('postgres'), () => {}, apis([])).host).toBe('127.0.0.1');
    expect(clientConfig(conn('postgres'), () => {}, apis([]))).not.toHaveProperty('stream');
  });

  it('PostgreSQL: the stream connects to the real host even though pg connects to the name', async () => {
    const { server, port } = await listener();
    try {
      const stream = (clientConfig(conn('postgres', { ...withName, port }), () => {}, apis([])) as unknown as { stream: () => import('node:net').Socket }).stream();
      const arrived = new Promise<void>((resolve) => server.once('connection', () => resolve()));
      stream.connect(1, NAME);
      await arrived;
      stream.destroy();
    } finally {
      server.close();
    }
  });

  it('MySQL: the name as host, a stream to the real host, verification and identity still on', async () => {
    const ca = file('ca.pem', CA);
    const { server, port } = await listener();
    try {
      const options = connectionOptions(conn('mysql', { ...withName, tlsCaFile: ca, port }));
      expect(options).toMatchObject({ host: NAME, ssl: { rejectUnauthorized: true, verifyIdentity: true } });
      expect((options.ssl as { ca: string[] }).ca.at(-1)).toBe(CA);
      const arrived = new Promise<void>((resolve) => server.once('connection', () => resolve()));
      const stream = (options as unknown as { stream: () => import('node:net').Socket }).stream();
      await arrived;
      stream.destroy();
    } finally {
      server.close();
    }
    expect(connectionOptions(conn('mysql'))).toMatchObject({ host: '127.0.0.1' });
    expect(connectionOptions(conn('mysql'))).not.toHaveProperty('stream');
  });

  it('SQL Server: tedious gets serverName, and the CA file joins its trust', () => {
    const ca = file('ca.pem', CA);
    const config = connectionConfig(conn('sqlserver', { ...withName, tlsCaFile: ca }), () => {}, apis(['CORP-ROOT']));
    expect(config.server).toBe('127.0.0.1');
    expect(config.options).toMatchObject({ encrypt: true, trustServerCertificate: false, serverName: NAME, cryptoCredentialsDetails: { ca: ['BUNDLED-1', 'CORP-ROOT', CA] } });
    expect(connectionConfig(conn('sqlserver'), () => {}, apis([])).options).not.toHaveProperty('serverName');
  });

  it('Hive and Impala: SNI and the identity check name the TLS name; the socket target stays host', () => {
    const plain = tlsOptions('hive.imagile.dev', 10000, { ca: undefined });
    expect(plain).toMatchObject({ host: 'hive.imagile.dev', servername: 'hive.imagile.dev', rejectUnauthorized: true });
    expect(plain).not.toHaveProperty('checkServerIdentity');
    const named = tlsOptions('10.0.0.5', 10000, { ca: ['X'], serverName: NAME });
    expect(named).toMatchObject({ host: '10.0.0.5', port: 10000, servername: NAME, ca: ['X'], rejectUnauthorized: true });
    // An identity check against the name rejects a certificate that doesn't carry it.
    const check = named.checkServerIdentity!;
    expect(check('10.0.0.5', { subject: { CN: 'other.imagile.dev' }, subjectaltname: 'DNS:other.imagile.dev' } as never)).toBeInstanceOf(Error);
    expect(check('10.0.0.5', { subject: { CN: NAME }, subjectaltname: `DNS:${NAME}` } as never)).toBeUndefined();
  });

  it('MySQL: a failed TLS handshake (mysql2 code HANDSHAKE_SSL_ERROR) is NETWORK, with the TLS fix and mysql2\'s own words', () => {
    const failure = Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: other.imagile.dev. is not in the cert's altnames: DNS:db.imagile.dev"), { code: 'HANDSHAKE_SSL_ERROR' });
    expect(toToilError(failure, conn('mysql'), 'read')).toMatchObject({ code: 'NETWORK', message: expect.stringContaining("does not match certificate's altnames"), fix: expect.stringContaining('tlsServerName') });
    // The same words with no handshake code are some other failure.
    expect(toToilError(new Error(failure.message), conn('mysql'), 'read')).toMatchObject({ code: 'DATABASE' });
  });

  it('names the override in the debug line', () => {
    expect(tlsLabel({})).toBe('TLS');
    expect(tlsLabel({ tlsServerName: NAME })).toBe(`TLS, verifying ${NAME}`);
  });
});

function listener(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.destroy());
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

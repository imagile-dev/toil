import { posix, win32 } from 'node:path';
import { remotePathKind } from '../../core/local-path.js';
import { type Collector, engineFor, passwordDropped, port, TERADATA_REASON, truthy, type DbSettings } from './common.js';

/**
 * One connection string, of any of the shapes people paste: a URL
 * (`postgres://`), a JDBC URL (`jdbc:sqlserver://host;databaseName=x`), an
 * ADO.NET string (`Server=...;Initial Catalog=...`) or the path of a SQLite
 * file. DBeaver, DataGrip and `--url` all land here, so there is one place
 * that knows what `encrypt=true` means in four dialects. Nobody agreed on a
 * connection string format; each vendor merely noticed that the others had one
 * and chose differently.
 *
 * A password found in the string is dropped, never returned: the result has
 * nowhere to put it, and says in `warnings` that it was there.
 */
export type Mapped = { engine: string; settings: DbSettings; warnings: string[] } | { skip: string };

/** `key=value` pairs from a `;`-separated or `&`-separated list, keys lowercased, first of a repeated key kept. */
function pairs(text: string, separator: ';' | '&'): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of splitOutsideQuotes(text, separator)) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    let value = part.slice(at + 1).trim();
    if (separator === '&') value = decode(value);
    else if (/^(["']).*\1$/s.test(value)) value = value.slice(1, -1);
    else if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote = '';
  let current = '';
  for (const c of text) {
    if (quote) {
      current += c;
      if (c === quote) quote = '';
    } else if ((c === '"' || c === "'") && /=\s*$/.test(current)) {
      quote = c;
      current += c;
    } else if (c === separator) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts.filter((p) => p.trim() !== '');
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** Splits `host:port`, `[::1]:port` and `host` ; a list of hosts keeps the first and says so. */
function hostAndPort(text: string, warnings: string[]): { host?: string; port?: number } {
  let first = text;
  if (text.includes(',') && !/^[^,]+,\d+$/.test(text)) {
    first = text.split(',')[0]!;
    warnings.push(`It lists several hosts; toil takes the first, ${first.trim()}.`);
  }
  first = first.trim();
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(first);
  if (v6) return { host: v6[1]!, ...(port(v6[2]) ? { port: port(v6[2])! } : {}) };
  // SQL Server's own spelling is host,port.
  const comma = /^([^,]+),(\d+)$/.exec(first);
  if (comma) return { host: comma[1]!.trim(), ...(port(comma[2]) ? { port: port(comma[2])! } : {}) };
  const colon = /^([^:]+):(\d+)$/.exec(first);
  if (colon) return { host: colon[1]!, ...(port(colon[2]) ? { port: port(colon[2])! } : {}) };
  return first === '' ? {} : { host: first };
}

const NAMED_INSTANCE = (host: string, instance: string) =>
  `names the SQL Server instance ${host}\\${instance}, which toil can't find by name: it connects by host and port. Give the instance's TCP port (host ${host}).`;

const LOCAL = /^(\(local\)|\.|localhost|\(localdb\).*)$/i;

/** Maps one connection string; `{ skip }` says why it can't be, in words that follow the connection's name. */
export function parseConnectionString(raw: string): Mapped {
  const text = raw.trim();
  if (text === '') return { skip: 'has an empty connection string' };
  if (/^[a-z]:[\\/]/i.test(text) || text.startsWith('/') || text.startsWith('\\\\')) return sqliteFile(text, []);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme) return fromUrl(text);
  if (text.includes('=')) return fromAdo(text);
  return { skip: `has a connection string toil doesn't recognise (it isn't a URL, a JDBC URL, an ADO.NET string or an absolute file path)` };
}

function sqliteFile(raw: string, warnings: string[]): Mapped {
  let path = raw.replace(/^file:/i, '').replace(/\?.*$/, '');
  if (path.startsWith('///')) path = path.slice(2);
  else if (/^\/\/[a-z]:/i.test(path)) path = path.slice(2);
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1);
  if (remotePathKind(path)) return { skip: 'is a SQLite file on another machine or a device path, which toil does not open' };
  if (!win32.isAbsolute(path) && !posix.isAbsolute(path)) {
    return { skip: `is a SQLite file at the relative path ${path}; toil needs an absolute one, so there is nothing to import` };
  }
  return { engine: 'sqlite', settings: { path }, warnings };
}

function fromUrl(text: string): Mapped {
  const warnings: string[] = [];
  let rest = text;
  if (/^jdbc:/i.test(rest)) rest = rest.slice(5);
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(rest);
  const proto = m![1]!.toLowerCase();
  const tail = m![2]!;

  if (proto === 'sqlite' || proto === 'file') return sqliteFile(tail, warnings);
  if (proto === 'oracle') return fromOracle(tail, warnings);
  if (/^(mongodb|redis|cassandra|couchbase|neo4j|bolt|clickhouse|snowflake|bigquery|redshift|cockroachdb|db2|h2|derby|hsqldb|firebird|informix|sybase|jtds|trino|presto)/.test(proto)) {
    if (proto === 'jtds') return fromUrl(`jdbc:sqlserver:${tail.replace(/^[a-z]+:/i, '')}`);
    return { skip: `uses ${proto}, a database toil has no driver for` };
  }
  if (proto === 'teradata') return { skip: TERADATA_REASON };
  const engine = proto === 'hive2' ? 'hive' : engineFor(proto);
  if (!engine) return { skip: `uses ${proto}, a database toil has no driver for` };

  const a = /^\/\/(?:([^@/?#;]*)@)?([^/?#;]*)([^?#;]*)(;[^?#]*)?(?:\?([^#]*))?/.exec(tail);
  if (!a) return { skip: `has a ${proto} URL toil can't read (expected ${proto}://host...)` };
  const [, userinfo, hosts, path, semi, query] = a;
  const params = new Map<string, string>([...pairs(semi?.slice(1) ?? '', ';'), ...pairs(query ?? '', '&')]);
  // For SQL Server the host list may carry \instance; check before the host is split.
  const where = hostAndPort(decode(hosts ?? ''), warnings);
  const settings: DbSettings = {};
  if (where.host) settings.host = where.host;
  if (where.port) settings.port = where.port;
  const pathDb = decode((path ?? '').replace(/^\//, ''));
  const database = params.get('databasename') ?? params.get('database') ?? params.get('dbname') ?? (pathDb !== '' ? pathDb : undefined);
  if (database) settings.database = database;

  let user: string | undefined;
  if (userinfo) {
    const colon = userinfo.indexOf(':');
    user = decode(colon < 0 ? userinfo : userinfo.slice(0, colon));
    if (colon >= 0 && userinfo.slice(colon + 1) !== '') warnings.push(passwordDropped('The URL'));
  }
  user ??= params.get('user') ?? params.get('username') ?? params.get('uid');
  if (user) settings.user = user;
  if (params.has('password') || params.has('pwd')) warnings.push(passwordDropped('The URL'));

  if (engine === 'postgres') {
    const mode = (params.get('sslmode') ?? '').toLowerCase();
    if (truthy(params.get('ssl')) || ['require', 'verify-ca', 'verify-full'].includes(mode)) settings.ssl = true;
  } else if (engine === 'mysql') {
    const mode = (params.get('sslmode') ?? '').toLowerCase();
    if (truthy(params.get('usessl')) || truthy(params.get('ssl')) || ['required', 'verify_ca', 'verify_identity'].includes(mode)) settings.ssl = true;
  } else if (engine === 'sqlserver') {
    const instance = /^([^\\]+)\\(.+)$/.exec(settings.host ?? '');
    if (instance) return { skip: NAMED_INSTANCE(instance[1]!, instance[2]!) };
    if (params.get('instancename')) return { skip: NAMED_INSTANCE(settings.host ?? 'host', params.get('instancename')!) };
    if (!settings.host && params.get('servername')) settings.host = params.get('servername')!;
    if (!settings.port && port(params.get('portnumber'))) settings.port = port(params.get('portnumber'))!;
    if (settings.host && LOCAL.test(settings.host)) settings.host = 'localhost';
    const sign = sqlServerSignIn(params);
    if ('skip' in sign) return sign;
    Object.assign(settings, sign.settings);
  } else if (engine === 'hive' || engine === 'impala') {
    if (params.has('principal') || /kerberos/i.test(params.get('auth') ?? '')) return { skip: `signs in with Kerberos, which toil doesn't support for ${engine}` };
    if (/^nosasl$/i.test(params.get('auth') ?? '')) settings.auth = 'nosasl';
    if (truthy(params.get('ssl'))) settings.ssl = true;
    if (/^impala$/.test(proto) && !where.port) warnings.push('It names no port, so toil will use its default.');
  }
  return { engine, settings, warnings };
}

/** The sign-in settings of a SQL Server connection, from JDBC properties or ADO.NET keywords (already lowercased). */
function sqlServerSignIn(params: Map<string, string>): { settings: DbSettings } | { skip: string } {
  const settings: DbSettings = {};
  const method = (params.get('authentication') ?? '').toLowerCase().replace(/[\s_]/g, '');
  if (method && !['sqlpassword', 'notspecified', 'sqllogin', 'ntlm'].includes(method)) {
    return { skip: `signs in with ${params.get('authentication')}, which toil doesn't support (it takes a SQL Server login or Windows authentication)` };
  }
  const integrated = params.get('integratedsecurity') ?? params.get('trustedconnection');
  if (truthy(integrated) || /^sspi$/i.test(integrated ?? '')) settings.auth = 'windows';
  const encrypt = (params.get('encrypt') ?? '').toLowerCase();
  if (['true', 'yes', 'mandatory', 'strict'].includes(encrypt)) settings.ssl = true;
  const domain = params.get('domain');
  if (domain) settings.domain = domain;
  return { settings };
}

function fromOracle(tail: string, warnings: string[]): Mapped {
  const m = /^(?:thin|oci8?|oci):([^@]*)@(.*)$/is.exec(tail);
  if (!m) return { skip: "has an Oracle URL toil can't read (expected jdbc:oracle:thin:@//host:port/service)" };
  const settings: DbSettings = {};
  const credentials = m[1]!;
  if (credentials !== '') {
    const slash = credentials.indexOf('/');
    const user = slash < 0 ? credentials : credentials.slice(0, slash);
    if (user) settings.user = user;
    if (slash >= 0 && credentials.slice(slash + 1) !== '') warnings.push(passwordDropped('The URL'));
  }
  let address = m[2]!.trim();
  if (address.startsWith('(')) return { skip: 'uses an Oracle connect descriptor; import its tnsnames.ora with --from tnsnames instead' };
  const tcps = /^tcps:/i.test(address);
  address = address.replace(/^tcps?:/i, '').replace(/^\/\//, '');
  const sid = /^([^:/]+):(\d+):([^/:]+)$/.exec(address);
  if (sid) return { skip: `names the Oracle SID ${sid[3]}, not a service name; toil's Oracle driver connects by service name. Find the service name (lsnrctl services) and use --url with it` };
  const svc = /^([^:/]+)(?::(\d+))?\/([^?]+)/.exec(address);
  if (!svc) return { skip: "has an Oracle URL toil can't read (expected host:port/service)" };
  settings.host = svc[1]!;
  if (port(svc[2])) settings.port = port(svc[2])!;
  settings.database = svc[3]!;
  if (tcps) settings.ssl = true;
  return { engine: 'oracle', settings, warnings };
}

function fromAdo(text: string): Mapped {
  const kv = new Map<string, string>();
  for (const [k, v] of pairs(text, ';')) kv.set(k.replace(/[\s_]/g, ''), v);
  return fromKeywords(kv, 'The connection string');
}

/**
 * ADO.NET keywords (lowercased, spaces and underscores removed: `initialcatalog`,
 * `userid`) as a connection. The SSMS and Azure Data Studio importers build the same
 * map from their own fields, so a setting means the same thing in all of them.
 */
export function fromKeywords(kv: Map<string, string>, source: string): Mapped {
  const warnings: string[] = [];
  const settings: DbSettings = {};
  if (kv.has('password') || kv.has('pwd')) warnings.push(passwordDropped(source));
  const server = kv.get('server') ?? kv.get('datasource') ?? kv.get('address') ?? kv.get('addr') ?? kv.get('networkaddress');
  const pg = kv.get('host');
  if (!server && pg) {
    // Npgsql's keywords.
    settings.host = pg;
    const p = port(kv.get('port'));
    if (p) settings.port = p;
    const db = kv.get('database');
    if (db) settings.database = db;
    const user = kv.get('username') ?? kv.get('userid');
    if (user) settings.user = user;
    if (['require', 'verifyca', 'verifyfull'].includes((kv.get('sslmode') ?? '').toLowerCase())) settings.ssl = true;
    return { engine: 'postgres', settings, warnings };
  }
  if (!server) return { skip: "has an ADO.NET connection string with no Server or Data Source, so there is no host to connect to" };
  let address = server.replace(/^(tcp|np|lpc):/i, '');
  if (/^np:/i.test(server) || address.startsWith('\\\\')) return { skip: 'connects over a named pipe, which toil does not' };
  if (/\.(db|sqlite3?|db3)$/i.test(address) && !address.includes(',')) return sqliteFile(address, warnings);
  const instance = /^([^\\,]+)\\([^,]+)(?:,(\d+))?$/.exec(address);
  if (instance && !instance[3]) return { skip: NAMED_INSTANCE(instance[1]!, instance[2]!) };
  if (instance) address = `${instance[1]},${instance[3]}`;
  const where = hostAndPort(address, warnings);
  if (where.host) settings.host = LOCAL.test(where.host) ? 'localhost' : where.host;
  const p = where.port ?? port(kv.get('port'));
  if (p) settings.port = p;
  const db = kv.get('initialcatalog') ?? kv.get('database');
  if (db) settings.database = db;
  const user = kv.get('userid') ?? kv.get('uid') ?? kv.get('user') ?? kv.get('username');
  if (user) settings.user = user;
  const sign = sqlServerSignIn(kv);
  if ('skip' in sign) return sign;
  Object.assign(settings, sign.settings);
  if (kv.has('multisubnetfailover') || kv.has('failoverpartner')) warnings.push('It uses a failover setting toil does not support, so it connects only to the server named.');
  return { engine: 'sqlserver', settings, warnings };
}


/** Adds a mapped connection to the collector, or records why it couldn't be; `extra` warnings ride along. */
export function addMapped(out: Collector, label: string, group: string[], mapped: Mapped, extra: string[] = [], tweak?: (s: DbSettings) => void): void {
  if ('skip' in mapped) {
    out.skip(label, mapped.skip, group);
    return;
  }
  tweak?.(mapped.settings);
  out.add({ label, group, engine: mapped.engine, settings: mapped.settings, warnings: [...mapped.warnings, ...extra] });
}

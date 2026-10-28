import { Collector, entries, ImportFormatError, own, passwordDropped, port, str, truthy, type DbSettings, type Parsed } from './common.js';
import { parseJsonc } from './readers.js';

/**
 * The two places PostgreSQL tools keep a server list as plain text that is safe
 * to read: pgAdmin's `servers.json` export, and libpq's `pg_service.conf`. Both
 * shaped from their documentation, not captured from a live install.
 *
 * `.pgpass` is the other file in this family and is deliberately absent. It is a
 * list of passwords, and a list of passwords is a thing toil is not for. A
 * `PassFile` or `passfile` in either file is noted and left alone.
 */

const SSL_ON = ['require', 'verify-ca', 'verify-full'];

/** pgAdmin's Import/Export Servers file: `{ "Servers": { "1": { "Name", "Group", "Host", "Port", "MaintenanceDB", "Username", "SSLMode" } } }`. */
export function parsePgadmin(text: string): Parsed {
  const servers = own(parseJsonc(text, 'The file'), 'Servers');
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    throw new ImportFormatError('The file has no "Servers" object, so it is not a pgAdmin servers.json export.');
  }
  const out = new Collector();
  for (const [key, s] of entries(servers)) {
    const label = str(own(s, 'Name')) ?? key;
    const group = str(own(s, 'Group'));
    // "Servers" is the group every pgAdmin has; naming every connection after it says nothing.
    const groups = group && group !== 'Servers' ? [group] : [];
    if (truthy(own(s, 'UseSSHTunnel'))) {
      out.skip(label, "goes through an SSH tunnel, which toil can't open: importing the host alone would point at the wrong machine", groups);
      continue;
    }
    const host = str(own(s, 'Host')) ?? str(own(s, 'HostAddr'));
    if (!host) {
      out.skip(label, str(own(s, 'Service')) ? `uses the libpq service ${str(own(s, 'Service'))}; import your pg_service.conf with --from pg-service instead` : 'names no host', groups);
      continue;
    }
    if (host.startsWith('/')) {
      out.skip(label, 'connects over a Unix socket, which toil does not', groups);
      continue;
    }
    const warnings: string[] = [];
    const settings: DbSettings = { host };
    if (port(own(s, 'Port'))) settings.port = port(own(s, 'Port'))!;
    const db = str(own(s, 'MaintenanceDB'));
    if (db) settings.database = db;
    const user = str(own(s, 'Username'));
    if (user) settings.user = user;
    if (SSL_ON.includes((str(own(s, 'SSLMode')) ?? '').toLowerCase())) settings.ssl = true;
    if (str(own(s, 'PassFile'))) warnings.push('It names a password file; toil never reads one. Enter the password with toil connections login.');
    if (str(own(s, 'Password'))) warnings.push(passwordDropped('The entry'));
    out.add({ label, group: groups, engine: 'postgres', settings, warnings });
  }
  return out.result();
}

/** libpq's `pg_service.conf`: INI sections of `host`, `port`, `dbname`, `user`, `sslmode`. */
export function parsePgService(text: string): Parsed {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = new Map();
      sections.set(header[1]!.trim(), current);
      continue;
    }
    const at = line.indexOf('=');
    if (current && at > 0) current.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  if (sections.size === 0) throw new ImportFormatError('The file has no [service] sections, so it is not a pg_service.conf.');
  const out = new Collector();
  for (const [name, kv] of sections) {
    const host = kv.get('host') || kv.get('hostaddr');
    if (!host) {
      out.skip(name, 'names no host');
      continue;
    }
    if (host.startsWith('/')) {
      out.skip(name, 'connects over a Unix socket, which toil does not');
      continue;
    }
    const warnings: string[] = [];
    const settings: DbSettings = { host };
    if (port(kv.get('port'))) settings.port = port(kv.get('port'))!;
    const user = kv.get('user');
    if (user) settings.user = user;
    const dbname = kv.get('dbname');
    if (dbname) settings.database = dbname;
    else if (user) {
      // libpq's own rule; toil's PostgreSQL connections need the database spelled out.
      settings.database = user;
      warnings.push(`It names no dbname; libpq connects to a database named after the user (${user}), so toil does too.`);
    }
    if (SSL_ON.includes((kv.get('sslmode') ?? '').toLowerCase())) settings.ssl = true;
    if (kv.has('password')) warnings.push(passwordDropped('The service'));
    if (kv.has('passfile')) warnings.push('It names a password file; toil never reads one. Enter the password with toil connections login.');
    out.add({ label: name, group: [], engine: 'postgres', settings, warnings });
  }
  return out.result();
}

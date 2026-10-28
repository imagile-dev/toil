import { Collector, engineFor, entries, ImportFormatError, own, passwordDropped, port, str, TERADATA_REASON, truthy, type DbSettings, type Parsed } from './common.js';
import { parseJsonc } from './readers.js';
import { parseConnectionString } from './strings.js';

/**
 * DBeaver's `data-sources.json`. Shaped from DBeaver's documentation and the
 * files it writes, not captured from a live export.
 *
 * DBeaver keeps users and passwords in `credentials-config.json`, encrypted
 * with a key that ships inside every copy of DBeaver. toil does not open that
 * file and never will: whoever can read this one gets hostnames, which is the
 * point of the exercise, and not the keys to the building.
 */

/** Drivers toil has no engine for even where DBeaver files them under a provider toil knows (Redshift is a PostgreSQL provider with opinions). */
const NOT_SUPPORTED = /redshift|greenplum|cockroach|yugabyte|azure|synapse|snowflake|bigquery|db2|\bh2\b|derby|mongo|cassandra|clickhouse|trino|presto|sybase|firebird|informix|hsql|athena|vertica|jtds_?old/i;

/** Properties whose meaning the import already carries over (ssl) or that carry nothing worth naming. */
const KNOWN_PROPERTIES = /^(ssl|usessl|sslmode|encrypt|trustservercertificate|applicationname|loginTimeout|connecttimeout|characterencoding|sslfactory)$/i;

export function parseDbeaver(text: string): Parsed {
  const root = parseJsonc(text, 'The file');
  const connections = own(root, 'connections');
  if (typeof connections !== 'object' || connections === null || Array.isArray(connections)) {
    throw new ImportFormatError('The file has no "connections" object, so it is not a DBeaver data-sources.json.');
  }
  const folders = own(root, 'folders');
  const out = new Collector();

  for (const [id, conn] of entries(connections)) {
    const label = str(own(conn, 'name')) ?? id;
    const cfg = own(conn, 'configuration');
    const provider = str(own(conn, 'provider')) ?? '';
    const driver = str(own(conn, 'driver')) ?? '';
    const group = folderPath(folders, str(own(conn, 'folder')));

    if (NOT_SUPPORTED.test(driver) || NOT_SUPPORTED.test(provider)) {
      out.skip(label, `uses the ${driver || provider} driver, a database toil has no driver for`, group);
      continue;
    }
    const handlers = entries(own(cfg, 'handlers'));
    const tunnel = handlers.find(([name, h]) => truthy(own(h, 'enabled')) && /ssh|tunnel|proxy/i.test(`${name} ${str(own(h, 'type')) ?? ''}`));
    if (tunnel) {
      out.skip(label, `goes through ${/proxy/i.test(tunnel[0]) ? 'a proxy' : 'an SSH tunnel'} (${tunnel[0]}), which toil can't open: importing the host alone would point at the wrong machine`, group);
      continue;
    }

    const warnings: string[] = [];
    const engine = engineFor(driver) ?? engineFor(provider);
    const url = str(own(cfg, 'url'));
    const manual = str(own(cfg, 'host')) !== undefined && str(own(cfg, 'configurationType'))?.toUpperCase() !== 'URL';
    let found: { engine: string; settings: DbSettings } | undefined;
    if (url && !manual) {
      const mapped = parseConnectionString(url);
      if ('skip' in mapped) {
        out.skip(label, mapped.skip, group);
        continue;
      }
      warnings.push(...mapped.warnings);
      found = mapped;
    }
    const chosen = engine ?? found?.engine;
    if (chosen === 'teradata') {
      out.skip(label, TERADATA_REASON, group);
      continue;
    }
    if (!chosen) {
      out.skip(label, `uses the ${driver || provider || 'unknown'} driver, a database toil has no driver for`, group);
      continue;
    }
    const settings: DbSettings = found?.engine === chosen ? { ...found.settings } : {};
    const host = str(own(cfg, 'host'));
    const database = str(own(cfg, 'database'));
    const user = str(own(cfg, 'user'));
    if (chosen === 'sqlite') {
      const path = database ?? settings.path;
      if (path) settings.path = path;
      delete settings.database;
    } else {
      if (host) settings.host = host;
      if (port(own(cfg, 'port'))) settings.port = port(own(cfg, 'port'))!;
      if (database) settings.database = database;
    }
    if (user) settings.user = user;
    else if (chosen !== 'sqlite' && !settings.user) warnings.push("No user in the file: DBeaver keeps it, with the password, in its encrypted credentials-config.json, which toil never reads.");
    if (own(cfg, 'password') !== undefined && str(own(cfg, 'password'))) warnings.push(passwordDropped('The connection'));

    const model = (str(own(cfg, 'auth-model')) ?? '').toLowerCase();
    if (/kerberos|gss|azure|aad|entra|oauth|iam|token|certificate/.test(model)) {
      out.skip(label, `signs in with the ${model} authentication model, which toil doesn't support`, group);
      continue;
    }
    if (chosen === 'sqlserver' && /ntlm|integrated|windows|sspi/.test(model)) settings.auth = 'windows';
    if (/pgpass/.test(model)) warnings.push("It reads its password from .pgpass; toil never reads that file. Enter the password with toil connections login.");

    const props = entries(own(cfg, 'properties'));
    if (handlers.some(([name, h]) => /ssl/i.test(name) && truthy(own(h, 'enabled')))) settings.ssl = true;
    for (const [key, value] of props) {
      const k = key.toLowerCase();
      if (['ssl', 'usessl'].includes(k) && truthy(value)) settings.ssl = true;
      if (k === 'sslmode' && /^(require|verify-ca|verify-full|required|verify_ca|verify_identity)$/i.test(String(value))) settings.ssl = true;
      if (k === 'encrypt' && /^(true|yes|mandatory|strict)$/i.test(String(value))) settings.ssl = true;
    }
    const unknown = props.map(([k]) => k).filter((k) => !KNOWN_PROPERTIES.test(k));
    if (unknown.length > 0) warnings.push(`Driver properties not imported (toil has no place for them): ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ''}.`);
    out.add({ label, group, engine: chosen, settings, warnings });
  }
  return out.result();
}

/** A folder's full path, outermost first, following `parent` links (at most 16 deep, and never in circles). */
function folderPath(folders: unknown, folder: string | undefined): string[] {
  if (!folder) return [];
  const names = folder.split('/').filter(Boolean);
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = names[0];
  while (current && !seen.has(current) && path.length < 16) {
    seen.add(current);
    path.unshift(current);
    current = str(own(own(folders, current), 'parent'));
  }
  return [...path, ...names.slice(1)];
}

import { Collector, ImportFormatError, own, passwordDropped, port, str, type Parsed } from './common.js';
import { parseJsonc } from './readers.js';
import { addMapped, fromKeywords } from './strings.js';

/**
 * The SQL Server connections saved in an editor's `settings.json`: Azure Data
 * Studio's `datasource.connections` and the VS Code MSSQL extension's
 * `mssql.connections`. Shaped from both tools' documented settings, not captured
 * from a live profile. The file is JSON with comments and trailing commas, which
 * is JSON in the way a draft is a letter.
 *
 * A `password` field is dropped unread. Microsoft Entra sign-in (`AzureMFA` and
 * its relatives) is skipped: it needs a browser login, which toil never makes
 * (principle 1).
 */
export function parseMssqlSettings(text: string, setting: 'datasource.connections' | 'mssql.connections'): Parsed {
  const root = parseJsonc(text, 'The file');
  const [first, second] = setting.split('.') as [string, string];
  const list = own(root, setting) ?? own(own(root, first), second);
  if (!Array.isArray(list)) throw new ImportFormatError(`The file has no "${setting}" setting, so there is nothing to import from it.`);
  const groups = new Map<string, { name: string; parent: string | undefined }>();
  const groupList = own(root, 'datasource.connectionGroups') ?? own(own(root, 'datasource'), 'connectionGroups');
  if (Array.isArray(groupList)) {
    for (const g of groupList) {
      const id = str(own(g, 'id'));
      const name = str(own(g, 'name'));
      if (id && name) groups.set(id, { name, parent: str(own(g, 'parentId')) });
    }
  }
  const out = new Collector();
  for (const [index, item] of list.entries()) {
    // Azure Data Studio nests the settings under "options"; the VS Code extension keeps them flat.
    const o = typeof own(item, 'options') === 'object' && own(item, 'options') !== null ? own(item, 'options') : item;
    const label = str(own(item, 'profileName')) ?? str(own(o, 'profileName')) ?? str(own(item, 'connectionName')) ?? str(own(o, 'connectionName')) ?? str(own(o, 'server')) ?? `connection ${index + 1}`;
    const group = groupPath(groups, str(own(item, 'groupId')));
    const kv = new Map<string, string>();
    const warnings: string[] = [];
    const connectionString = str(own(o, 'connectionString'));
    if (connectionString) {
      // A full string: its own keywords say everything, so the loose fields are ignored.
      for (const part of connectionString.split(';')) {
        const at = part.indexOf('=');
        if (at > 0) kv.set(part.slice(0, at).trim().toLowerCase().replace(/[\s_]/g, ''), part.slice(at + 1).trim());
      }
    } else {
      const server = str(own(o, 'server'));
      if (!server) {
        out.skip(label, 'names no server');
        continue;
      }
      const p = port(own(o, 'port'));
      kv.set('server', p && !/[,:]\d+$/.test(server) && !server.includes('\\') ? `${server},${p}` : server);
      const db = str(own(o, 'database'));
      if (db) kv.set('database', db);
      const user = str(own(o, 'user'));
      if (user) kv.set('userid', user);
      const method = str(own(o, 'authenticationType')) ?? '';
      if (/^integrated$/i.test(method)) kv.set('integratedsecurity', 'true');
      else if (method && !/^sqllogin$/i.test(method)) kv.set('authentication', method);
      const encrypt = own(o, 'encrypt');
      if (encrypt !== undefined) kv.set('encrypt', String(encrypt));
      if (str(own(o, 'password'))) warnings.push(passwordDropped('The connection'));
    }
    addMapped(out, label, group, fromKeywords(kv, 'The connection string'), warnings);
  }
  return out.result();
}

function groupPath(groups: Map<string, { name: string; parent: string | undefined }>, id: string | undefined): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = id;
  while (current && !seen.has(current) && path.length < 16) {
    seen.add(current);
    const g = groups.get(current);
    if (!g) break;
    if (g.name !== 'ROOT') path.unshift(g.name);
    current = g.parent;
  }
  return path;
}

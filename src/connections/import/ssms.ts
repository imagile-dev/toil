import { Collector, ImportFormatError, str, type Parsed } from './common.js';
import { kids, local, readXml, textIn } from './readers.js';
import { addMapped, parseConnectionString } from './strings.js';
import type { XmlElement } from '../../areas/util/kit/xml.js';

/**
 * SQL Server Management Studio's Registered Servers: the `.regsrvr` file that
 * Registered Servers > Export writes (File > Export), and the `RegSrvr.xml`
 * that SSMS keeps in the user's app data. Shaped from Microsoft's documentation
 * of the format, not captured from a live export.
 *
 * Each server's `ConnectionStringWithEncryptedPassword` holds the whole
 * connection, password included, encrypted for one Windows user. It is read for
 * everything else it says and the password is thrown away unread. Server groups
 * become name prefixes, so `Prod` / `Orders` stays findable. SSMS's list of
 * recently used servers lives in a binary file (`SqlStudio.bin`), which is not
 * read: it is not an export format, it is a memory.
 */

/** Group names SSMS puts at the root of every store; they say where the tree starts, not where the server is. */
const ROOT_GROUPS = /^(DatabaseEngineServerGroup|CentralManagementServerGroup|Local Server Groups|Central Management Servers)$/i;

export function parseSsms(text: string): Parsed {
  const roots = readXml(text, 'The file');
  const out = new Collector();
  let servers = 0;
  // Iterative on purpose: a hostile file nests as deep as it likes, and the stack doesn't.
  const stack: Array<{ el: XmlElement; group: string[] }> = roots.map((el) => ({ el, group: [] }));
  while (stack.length > 0) {
    const { el, group } = stack.pop()!;
    const name = local(el);
    if (name === 'RegisteredServer') {
      servers++;
      registered(out, el, parentGroup(el) ?? group);
      continue;
    }
    let next = group;
    if (name === 'ServerGroup') {
      const label = textIn(kids(el, 'Name')[0], 0);
      if (label && !ROOT_GROUPS.test(label)) next = [...group, label];
    }
    const children = kids(el);
    for (let i = children.length - 1; i >= 0; i--) stack.push({ el: children[i]!, group: next });
  }
  if (servers === 0) throw new ImportFormatError('The file has no registered servers, so it is not a Registered Servers export (.regsrvr).');
  return out.result();
}

/**
 * The groups a server sits in, from the `Parent` URI a real export gives it
 * (`/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Prod`):
 * SSMS writes groups and servers as sibling SML-IF documents, not as a nest, so
 * the tree is in the addresses. `undefined` when the server has no Parent, which
 * is the nested layout, where the group comes from the elements around it.
 */
function parentGroup(server: XmlElement): string[] | undefined {
  const uri = textIn(kids(server, 'Parent')[0], 2);
  if (!uri) return undefined;
  const parts = uri.split('/');
  const names: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] !== 'ServerGroup') continue;
    let name = parts[i + 1]!;
    try {
      name = decodeURIComponent(name);
    } catch {
      // Not percent-encoded after all; keep it as written.
    }
    if (name !== '' && !ROOT_GROUPS.test(name)) names.push(name);
  }
  return names;
}

function registered(out: Collector, server: XmlElement, group: string[]): void {
  const label = textIn(kids(server, 'Name')[0], 0) ?? textIn(kids(server, 'ServerName')[0], 0) ?? 'unnamed server';
  const type = textIn(kids(server, 'ServerType')[0], 0);
  if (type && !/^DatabaseEngine$/i.test(type)) {
    out.skip(label, `is a ${type} server, not a database engine, so toil has no commands for it`, group);
    return;
  }
  const connectionString = textIn(kids(server, 'ConnectionStringWithEncryptedPassword')[0], 0);
  const serverName = textIn(kids(server, 'ServerName')[0], 0);
  const mapped = parseConnectionString(connectionString ?? (serverName ? `Server=${serverName}` : ''));
  if ('skip' in mapped) {
    out.skip(label, mapped.skip, group);
    return;
  }
  if (!mapped.settings.user && mapped.settings.auth !== 'windows') {
    out.skip(label, str(connectionString) ? 'names no login: neither a SQL Server user nor Windows authentication' : 'has no connection string, so how it signs in is not in the file', group);
    return;
  }
  addMapped(out, label, group, mapped);
}

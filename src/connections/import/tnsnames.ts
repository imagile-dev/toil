import { Collector, ImportFormatError, port, str, type DbSettings, type Parsed } from './common.js';

/**
 * Oracle's `tnsnames.ora`: aliases for a host, a port and a service name, written
 * as nested parentheses by a format that predates JSON, XML and, one suspects,
 * the idea of a parser. Shaped from Oracle's documented syntax, not captured from
 * a live client.
 *
 * It holds no user, so every connection imported from it needs `--user` or a
 * login added afterwards. A `SID` instead of a `SERVICE_NAME` is skipped: toil's
 * Thin-mode driver connects by service name, and guessing one from a SID is how
 * people end up on the wrong database.
 */

interface Node {
  key: string;
  value: string | undefined;
  children: Node[];
}

const MAX_DEPTH = 32;

export function parseTnsnames(text: string): Parsed {
  const src = text.replace(/^\uFEFF/, '').replace(/#[^\n]*/g, '');
  const out = new Collector();
  let i = 0;
  let entries = 0;
  const skipSpace = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };

  const group = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw new ImportFormatError(`The file nests parentheses more than ${MAX_DEPTH} levels deep, which no tnsnames.ora does.`);
    i++; // (
    const eq = src.indexOf('=', i);
    const close = src.indexOf(')', i);
    if (eq < 0 || (close >= 0 && close < eq)) throw new ImportFormatError(`The file has a malformed entry near character ${i}.`);
    const node: Node = { key: src.slice(i, eq).trim().toUpperCase(), value: undefined, children: [] };
    i = eq + 1;
    skipSpace();
    if (src[i] === '(') {
      while (src[i] === '(') {
        node.children.push(group(depth + 1));
        skipSpace();
      }
    } else {
      const end = src.indexOf(')', i);
      if (end < 0) throw new ImportFormatError('The file has an unclosed parenthesis.');
      node.value = src.slice(i, end).trim();
      i = end;
    }
    if (src[i] !== ')') throw new ImportFormatError(`The file has an unclosed parenthesis near character ${i}.`);
    i++;
    return node;
  };

  while (i < src.length) {
    skipSpace();
    if (i >= src.length) break;
    const eq = src.indexOf('=', i);
    if (eq < 0) break;
    const aliases = src
      .slice(i, eq)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    i = eq + 1;
    skipSpace();
    if (src[i] !== '(') {
      // IFILE = other.ora and its kin: a line, not an entry.
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const root = group(0);
    entries++;
    for (const alias of aliases) describe(out, alias, root);
  }
  if (entries === 0) throw new ImportFormatError('The file has no entries, so it is not a tnsnames.ora.');
  return out.result();
}

/** Every descendant with this key, found without recursion. */
function find(root: Node, key: string): Node[] {
  const found: Node[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.key === key) found.push(n);
    for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]!);
  }
  return found;
}

const valueOf = (node: Node | undefined, key: string): string | undefined => str(node ? find(node, key)[0]?.value : undefined);

function describe(out: Collector, alias: string, root: Node): void {
  const addresses = find(root, 'ADDRESS');
  const address = addresses[0];
  const host = valueOf(address, 'HOST');
  if (!address || !host) {
    out.skip(alias, 'names no HOST (it may use a protocol other than TCP, or a directory name)');
    return;
  }
  const protocol = (valueOf(address, 'PROTOCOL') ?? 'TCP').toUpperCase();
  if (protocol !== 'TCP' && protocol !== 'TCPS') {
    out.skip(alias, `uses the ${protocol} protocol, which toil does not`);
    return;
  }
  const connect = find(root, 'CONNECT_DATA')[0];
  const service = valueOf(connect, 'SERVICE_NAME');
  const sid = valueOf(connect, 'SID');
  if (!service) {
    out.skip(alias, sid ? `names the SID ${sid}, not a service name; toil's Oracle driver connects by service name` : 'names no SERVICE_NAME');
    return;
  }
  const warnings: string[] = [];
  const settings: DbSettings = { host, database: service };
  if (port(valueOf(address, 'PORT'))) settings.port = port(valueOf(address, 'PORT'))!;
  if (protocol === 'TCPS') settings.ssl = true;
  if (addresses.length > 1) warnings.push(`It lists ${addresses.length} addresses (failover or load balancing); toil takes the first, ${host}.`);
  out.add({ label: alias, group: [], engine: 'oracle', settings, warnings });
}

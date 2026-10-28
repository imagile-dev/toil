import type { XmlElement } from '../../areas/util/kit/xml.js';
import { Collector, ImportFormatError, passwordDropped, port, truthy, type DbSettings, type Parsed } from './common.js';
import { descendants, kids, readXml, textIn } from './readers.js';
import { addMapped, parseConnectionString } from './strings.js';

/**
 * Two desktop tools that keep their connections as XML: JetBrains DataGrip and
 * the other IDEs' `.idea/dataSources.xml`, and MySQL Workbench's
 * `connections.xml`. Both shaped from what the tools write, not captured from
 * a live install.
 *
 * Neither file holds a password toil would want (DataGrip keeps them in the
 * IDE's credential store, Workbench in the OS keyring), and any that turns up
 * is dropped like every other.
 */

/** DataGrip / IntelliJ `dataSources.xml`: one `<data-source>` per connection, with its JDBC URL. */
export function parseDatagrip(text: string): Parsed {
  const roots = readXml(text, 'The file');
  const sources = roots.flatMap((r) => descendants(r, 'data-source'));
  if (sources.length === 0) throw new ImportFormatError('The file has no <data-source> entries, so it is not a DataGrip dataSources.xml.');
  const out = new Collector();
  for (const ds of sources) {
    const label = ds.attrs.name ?? textIn(kids(ds, 'name')[0], 0) ?? 'unnamed data source';
    const ssh = descendants(ds, 'ssh-properties').find((s) => truthy(textIn(kids(s, 'enabled')[0], 0)));
    if (ssh) {
      out.skip(label, "goes through an SSH tunnel, which toil can't open: importing the host alone would point at the wrong machine");
      continue;
    }
    const url = textIn(kids(ds, 'jdbc-url')[0], 0);
    if (!url) {
      out.skip(label, 'has no JDBC URL in the file');
      continue;
    }
    const user = textIn(kids(ds, 'user-name')[0], 0);
    const warnings: string[] = [];
    const mapped = parseConnectionString(url);
    if (!('skip' in mapped) && !user && mapped.engine !== 'sqlite' && !mapped.settings.user && mapped.settings.auth !== 'windows') {
      warnings.push('No user in the file: DataGrip keeps it in dataSources.local.xml, which is not read.');
    }
    addMapped(out, label, [], mapped, warnings, (s) => {
      if (user && !s.user) s.user = user;
    });
  }
  return out.result();
}

const keyed = (el: XmlElement, key: string): XmlElement | undefined => kids(el).find((c) => c.attrs.key === key);

/** MySQL Workbench `connections.xml`: `db.mgmt.Connection` objects with a `parameterValues` dictionary. */
export function parseMysqlWorkbench(text: string): Parsed {
  const roots = readXml(text, 'The file');
  const conns = roots.flatMap((r) => descendants(r, 'value')).filter((v) => v.attrs['struct-name'] === 'db.mgmt.Connection');
  if (conns.length === 0) throw new ImportFormatError('The file has no db.mgmt.Connection entries, so it is not a MySQL Workbench connections.xml.');
  const out = new Collector();
  for (const c of conns) {
    const label = textIn(keyed(c, 'name'), 0) ?? 'unnamed connection';
    const driver = textIn(keyed(c, 'driver'), 1) ?? '';
    const params = keyed(c, 'parameterValues');
    const get = (key: string) => textIn(params ? keyed(params, key) : undefined, 0);
    if (/sshtun|ssh/i.test(driver)) {
      out.skip(label, "goes through an SSH tunnel, which toil can't open: importing the host alone would point at the wrong machine");
      continue;
    }
    if (/socket|pipe/i.test(driver)) {
      out.skip(label, 'connects over a local socket or named pipe, which toil does not');
      continue;
    }
    if (driver && !/mysql|mariadb/i.test(driver)) {
      out.skip(label, `uses the ${driver} driver, which isn't MySQL`);
      continue;
    }
    const host = get('hostName');
    if (!host) {
      out.skip(label, 'names no host');
      continue;
    }
    const warnings: string[] = [];
    const settings: DbSettings = { host };
    if (port(get('port'))) settings.port = port(get('port'))!;
    const user = get('userName');
    if (user) settings.user = user;
    const schema = get('schema');
    if (schema) settings.database = schema;
    // useSSL: 0 no, 1 if available, 2 require, 3 and verify CA, 4 and verify identity.
    if (Number(get('useSSL') ?? 0) >= 2) settings.ssl = true;
    if (get('password')) warnings.push(passwordDropped('The connection'));
    out.add({ label, group: [], engine: 'mysql', settings, warnings });
  }
  return out.result();
}


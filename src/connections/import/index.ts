import { posix, win32 } from 'node:path';
import type { Parsed } from './common.js';
import { parseDbeaver } from './dbeaver.js';
import { parseMssqlSettings } from './mssql-settings.js';
import { parsePgadmin, parsePgService } from './postgres.js';
import { parseSsms } from './ssms.js';
import { parseTnsnames } from './tnsnames.js';
import { parseDatagrip, parseMysqlWorkbench } from './xml-tools.js';

/**
 * Every tool `toil connections import` reads, one entry each: the parser (a pure
 * function from file text), where the tool keeps the file on each OS, and how a
 * person gets one when it isn't kept anywhere findable. The registry is the
 * only list; the command's `--from` choices, its help and its docs all come
 * from it, so a tool added here shows up everywhere or fails a test saying where
 * it didn't. A tool's "default location" is the sort of fact that moves in a minor
 * release, which is why a path you name always wins.
 */
export interface Where {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The names in a folder, or none when it isn't there. Injected so locations stay testable without a disk. */
  list: (dir: string) => string[];
}

export interface ImportFormat {
  id: string;
  label: string;
  /** File text in, candidate connections out. Throws `ImportFormatError` when the text isn't this format. */
  parse: (text: string) => Parsed;
  /** The files to look for when none is named, best first. */
  locations: (where: Where) => string[];
  /** How to get a file from the tool, for the error when none is found. */
  howTo: string;
}

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);

/** The folder desktop apps keep settings in: %APPDATA%, Application Support, or XDG's config home. */
function appData({ platform, home, env }: Where): string {
  const p = pathFor(platform);
  if (platform === 'win32') return env.APPDATA || p.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || p.join(home, '.config');
}

/** Version folders (`18.0`, `150`) newest first. */
const newestFirst = (names: string[]): string[] => [...names].filter((n) => /^\d+(\.\d+)*$/.test(n)).sort((a, b) => parseFloat(b) - parseFloat(a));

export const FORMATS: readonly ImportFormat[] = [
  {
    id: 'dbeaver',
    label: 'DBeaver',
    parse: parseDbeaver,
    locations: (w) => {
      const p = pathFor(w.platform);
      const data = w.platform === 'win32' ? appData(w) : w.platform === 'darwin' ? p.join(w.home, 'Library') : w.env.XDG_DATA_HOME || p.join(w.home, '.local', 'share');
      return [p.join(data, 'DBeaverData', 'workspace6', 'General', '.dbeaver', 'data-sources.json')];
    },
    howTo: "DBeaver writes data-sources.json in its workspace's General/.dbeaver folder; if you moved the workspace, pass that file. (File > Export > DBeaver > Project exports it too.)",
  },
  {
    id: 'ssms',
    label: 'SQL Server Management Studio',
    parse: parseSsms,
    locations: (w) => {
      if (w.platform !== 'win32') return [];
      const p = win32;
      const roots = [p.join(appData(w), 'Microsoft', 'SQL Server Management Studio'), p.join(appData(w), 'Microsoft', 'Microsoft SQL Server')];
      return roots.flatMap((root) => newestFirst(w.list(root)).flatMap((v) => [p.join(root, v, 'RegSrvr.xml'), p.join(root, v, 'Tools', 'Shell', 'RegSrvr.xml')]));
    },
    howTo: 'In SSMS, open View > Registered Servers, right-click the server group, choose Tasks > Export, and pass the .regsrvr file. (The list of recent servers in the connect dialog is a binary file and is not read.)',
  },
  {
    id: 'azure-data-studio',
    label: 'Azure Data Studio',
    parse: (t) => parseMssqlSettings(t, 'datasource.connections'),
    locations: (w) => [pathFor(w.platform).join(appData(w), 'azuredatastudio', 'User', 'settings.json')],
    howTo: "Azure Data Studio keeps its connections in its user settings.json (File > Preferences > Settings > Open Settings (JSON)), under datasource.connections. Pass that file.",
  },
  {
    id: 'vscode-mssql',
    label: 'VS Code (SQL Server extension)',
    parse: (t) => parseMssqlSettings(t, 'mssql.connections'),
    locations: (w) => {
      const p = pathFor(w.platform);
      return ['Code', 'Code - Insiders'].map((app) => p.join(appData(w), app, 'User', 'settings.json'));
    },
    howTo: 'The SQL Server extension keeps its connections in VS Code\'s user settings.json (Preferences: Open User Settings (JSON)), under mssql.connections. Pass that file.',
  },
  {
    id: 'pgadmin',
    label: 'pgAdmin',
    parse: parsePgadmin,
    locations: () => [],
    howTo: 'In pgAdmin, choose Object > Import/Export Servers..., export to a servers.json, and pass that file.',
  },
  {
    id: 'pg-service',
    label: 'PostgreSQL service file (pg_service.conf)',
    parse: parsePgService,
    locations: (w) => {
      const p = pathFor(w.platform);
      const found = [w.env.PGSERVICEFILE, p.join(w.home, '.pg_service.conf')];
      if (w.platform === 'win32') found.push(p.join(appData(w), 'postgresql', '.pg_service.conf'));
      if (w.env.PGSYSCONFDIR) found.push(p.join(w.env.PGSYSCONFDIR, 'pg_service.conf'));
      if (w.platform !== 'win32') found.push('/etc/postgresql-common/pg_service.conf', '/etc/pg_service.conf');
      return found.filter((f): f is string => Boolean(f));
    },
    howTo: 'libpq reads ~/.pg_service.conf (or the file PGSERVICEFILE names). Pass the file; .pgpass is never read.',
  },
  {
    id: 'mysql-workbench',
    label: 'MySQL Workbench',
    parse: parseMysqlWorkbench,
    locations: (w) => {
      const p = pathFor(w.platform);
      if (w.platform === 'win32') return [p.join(appData(w), 'MySQL', 'Workbench', 'connections.xml')];
      if (w.platform === 'darwin') return [p.join(appData(w), 'MySQL', 'Workbench', 'connections.xml')];
      return [p.join(w.home, '.mysql', 'workbench', 'connections.xml')];
    },
    howTo: "MySQL Workbench keeps connections.xml in its data folder (Help > Show Log Folder is beside it). Pass that file.",
  },
  {
    id: 'datagrip',
    label: 'DataGrip and other JetBrains IDEs',
    parse: parseDatagrip,
    locations: (w) => [pathFor(w.platform).join(w.cwd, '.idea', 'dataSources.xml')],
    howTo: "A JetBrains project's connections are in its .idea/dataSources.xml. Pass that file, or run the command from the project folder.",
  },
  {
    id: 'tnsnames',
    label: 'Oracle tnsnames.ora',
    parse: parseTnsnames,
    locations: (w) => {
      const p = pathFor(w.platform);
      return [w.env.TNS_ADMIN ? p.join(w.env.TNS_ADMIN, 'tnsnames.ora') : undefined, w.env.ORACLE_HOME ? p.join(w.env.ORACLE_HOME, 'network', 'admin', 'tnsnames.ora') : undefined].filter((f): f is string => Boolean(f));
    },
    howTo: 'Oracle clients read tnsnames.ora from TNS_ADMIN, or ORACLE_HOME/network/admin. Pass that file.',
  },
];

/** The ids `--from` accepts: every file format, and `url` for one connection string. */
export const FROM_VALUES = [...FORMATS.map((f) => f.id), "url"] as unknown as [string, ...string[]];

export function formatFor(id: string): ImportFormat | undefined {
  return FORMATS.find((f) => f.id === id);
}

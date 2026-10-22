import { ToilError } from '../errors.js';
import { hiveProvider, impalaProvider } from './hive/index.js';
import type { DbProvider } from './provider.js';
import { mysqlProvider } from './mysql/index.js';
import { oracleProvider } from './oracle/index.js';
import { postgresProvider } from './postgres/index.js';
import { sqliteProvider } from './sqlite/index.js';
import { sqlserverProvider } from './sqlserver/index.js';
import { teradataProvider } from './teradata/index.js';

/**
 * Every database engine toil ships, keyed by the `engine` value a connection
 * sets. Adding an engine is one import and one line here, plus its keys on
 * the connection schema. This is the only list; it is short enough that
 * nobody has yet proposed a working group to maintain it.
 */
export const providers: readonly DbProvider[] = [sqliteProvider, postgresProvider, mysqlProvider, sqlserverProvider, oracleProvider, teradataProvider, hiveProvider, impalaProvider];

export const engineNames = providers.map((p) => p.engine) as [string, ...string[]];

export function providerFor(engine: string): DbProvider {
  const provider = providers.find((p) => p.engine === engine);
  // The connection schema only admits known engines, so this is a bug, not a config mistake.
  if (!provider) throw new ToilError('INTERNAL', `No database provider for engine "${engine}".`);
  return provider;
}

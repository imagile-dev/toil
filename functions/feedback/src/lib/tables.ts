// Everything the feedback backend keeps lives in Azure Table Storage, behind
// this small interface so the handlers can be tested against an in-memory copy.
//
// The tables, created by infra/main.bicep:
//   submissions  PK "pending", RK "<ISO time>-<id>": a submission waiting to become an issue
//   ratelimits   PK "<yyyy-mm-dd>", RK "<route>-<sha256 of IP>": submissions per IP per day
//   counters     PK "issues", RK "<yyyy-mm-dd>": issues created that day
//   issues       PK "issue", RK "<number>": the submitter's email, until the closed notice goes out
//   commits      PK "commit", RK "<sha>": what GitHub said about a reported commit
//
// Five tables, each with one job, which is four fewer than a records-retention
// policy would ask for and exactly as many as anything here needs.

import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';

export type Entity = { partitionKey: string; rowKey: string } & Record<string, unknown>;
export type Stored<T extends Entity = Entity> = T & { etag: string };

export interface Table {
  get(partitionKey: string, rowKey: string): Promise<Stored | undefined>;
  /** Inserts; false when the row already exists. */
  create(entity: Entity): Promise<boolean>;
  /** Replaces the row if its etag still matches; false when someone else changed it first. */
  replace(entity: Stored): Promise<boolean>;
  upsert(entity: Entity): Promise<void>;
  delete(partitionKey: string, rowKey: string): Promise<void>;
  /** Every row in one partition, in row-key order. */
  list(partitionKey: string): Promise<Stored[]>;
}

export const TABLE_NAMES = ['submissions', 'ratelimits', 'counters', 'issues', 'commits'] as const;
export type TableName = (typeof TABLE_NAMES)[number];
export type Tables = Record<TableName, Table>;

const status = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'statusCode' in error ? Number((error as { statusCode: unknown }).statusCode) : undefined;

/** The storage account's tables, reached with the function's managed identity (no account key anywhere). */
export function azureTables(endpoint: string): Tables {
  const credential = new DefaultAzureCredential();
  const make = (name: string): Table => {
    // Azurite, for a local run, takes its well-known development connection string instead.
    const local = endpoint.startsWith('UseDevelopmentStorage=') || endpoint.includes('AccountKey=');
    const client = local
      ? TableClient.fromConnectionString(endpoint, name, { allowInsecureConnection: true })
      : new TableClient(endpoint, name, credential);
    // In Azure the tables exist already (infra/main.bicep); locally they're made on first use.
    let ready: Promise<void> | undefined;
    const exists = () => (local ? (ready ??= client.createTable().then(() => undefined)) : Promise.resolve());
    return {
      async get(partitionKey, rowKey) {
        await exists();
        try {
          const row = await client.getEntity<Record<string, unknown>>(partitionKey, rowKey);
          return row as unknown as Stored;
        } catch (error) {
          if (status(error) === 404) return undefined;
          throw error;
        }
      },
      async create(entity) {
        await exists();
        try {
          await client.createEntity(entity);
          return true;
        } catch (error) {
          if (status(error) === 409) return false;
          throw error;
        }
      },
      async replace(entity) {
        await exists();
        const { etag, ...row } = entity;
        try {
          await client.updateEntity(row as Entity, 'Replace', { etag });
          return true;
        } catch (error) {
          if (status(error) === 412 || status(error) === 404) return false;
          throw error;
        }
      },
      async upsert(entity) {
        await exists();
        await client.upsertEntity(entity, 'Replace');
      },
      async delete(partitionKey, rowKey) {
        await exists();
        try {
          await client.deleteEntity(partitionKey, rowKey);
        } catch (error) {
          if (status(error) !== 404) throw error;
        }
      },
      async list(partitionKey) {
        await exists();
        const rows: Stored[] = [];
        const filter = `PartitionKey eq '${partitionKey.replace(/'/g, "''")}'`;
        for await (const row of client.listEntities<Record<string, unknown>>({ queryOptions: { filter } })) rows.push(row as unknown as Stored);
        return rows.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
      },
    };
  };
  return Object.fromEntries(TABLE_NAMES.map((name) => [name, make(name)])) as Tables;
}

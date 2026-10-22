# Hive and Impala through one HiveServer2 provider (#408)

- **The driver is `hive-driver` 1.0.1 for its generated HiveServer2 client, on
  `thrift` 0.23.0, and not its client classes.** Both are pure JavaScript with no
  install scripts and no native addon; hive-driver only names the native `kerberos`
  module in a comment and never loads it. Its own `HiveClient` and transports leave a
  call waiting forever when the server drops the connection, emit unhandled `error`
  events, default TLS to `rejectUnauthorized: false`, and read a SASL reply from a
  single chunk, so `src/core/db/hive/hs2.ts` opens the socket, does the SASL PLAIN
  exchange and wraps the generated client itself: every call settles on close, error or
  the call's signal. `thrift` is pinned as a direct dev dependency at the version
  hive-driver resolves (its `^0.23.0` only allows 0.23.x).
- **The bundle replaces `isomorphic-ws` with a stub that throws (`src/shims/no-websocket.ts`).**
  The Thrift runtime loads its WebSocket transport at start, and `ws` asks for two
  optional native addons, which `check:pure` refuses. toil never opens a WebSocket.
- **The bundle rewrites `new Buffer(...)` in thrift and node-int64 to `Buffer.alloc` /
  `Buffer.from` (`tsup.config.ts`, `legacy-buffer`).** Node hides DEP0005 inside
  `node_modules`, but bundled the calls come from `dist/toil-lib.js`, so every Hive or
  Impala command printed a deprecation warning to stderr. Same semantics, since
  `new Buffer(n)` is zero-filled on every Node toil supports.
- **Thrift's own logging goes nowhere** (`thrift.setLogFunc(() => {})`): it writes
  protocol warnings with `console.log`, onto stdout, where the envelope goes.
- **`auth: "nosasl"` is a new value of the existing `auth` key**, not a new key: it's
  Hive's own name for the mode (`hive.server2.authentication=NOSASL`), it's what an
  unsecured Impala needs (it doesn't answer SASL at all), and it keeps one key for "how
  this connection signs in" across engines. Each engine's `check` refuses the other's
  values; SQL Server now refuses `nosasl`. With `nosasl`, a `password` is refused rather
  than silently unused.
- **`user` is required unless `auth` is `nosasl`**, because the docs require a
  read-only account, and the account is the user. `database` is optional and is the
  default schema (`default` without it), sent as `use:database`, which both engines read.
- **`db execute` runs one statement per call on Hive and Impala**, and refuses several
  with `INVALID_INPUT` before running any. Neither engine has a transaction, so a script
  that failed halfway would keep its first half, and `execute` promises all or nothing.
- **A read the server reports as having changed rows is `DATABASE`, not
  `WRITE_DISABLED`**: the change has been made, and `WRITE_DISABLED` says nothing was.
  It needs the server's row count, so it works on Hive 4 and Impala, not Hive 3.1.
- **No deny list for Hive's non-SQL commands (`dfs`, `add`, `delete`, `compile`,
  `reload`) on reads.** The maintainer's decision is a read-only account and no SQL
  parsing; the docs say the account must be refused those too, which Ranger and SQL
  standard authorization do for anyone not an administrator. The lint's
  `read-only-write` rule does learn the statements that are plainly writes on these
  engines (Hive's `LOAD`, `MSCK`, `EXPORT`, `IMPORT` and multi-insert `FROM ... INSERT`;
  Impala's `UPSERT`, `LOAD`, `COMPUTE`), as advice, the way it already knows `REPLACE`.
- **Impala's row count comes from `CloseImpalaOperation`, written by hand in the
  generated client's shape (`hs2.ts`, `impalaClose`).** HiveServer2 has no row count
  for a write, and Impala reports one only in its own extension of the service, which
  hive-driver doesn't generate. For an Iceberg `UPDATE`, which Impala counts as rows
  deleted and written again, `changes` is the larger of the two counts.
- **A cancel goes out on a second connection as well as the call's own**, and the first
  to land stops the statement. HiveServer2 answers one request per connection at a time,
  and Impala holds a fetch up to ten seconds, so a cancel on the call's own connection
  alone missed the conformance suite's five seconds. Behind a load balancer the second
  connection may reach another server; the call's own copy covers that.
- **Introspection uses the protocol's catalog calls** (GetSchemas, GetTables,
  GetColumns, GetPrimaryKeys, GetCrossReference) rather than `SHOW` and `DESCRIBE`, which
  differ between the engines and between Hive releases. Their name arguments are
  patterns, so every answer is filtered to the exact name. Names are looked up in lower
  case, which is how both engines store them. `sys` and `information_schema` (Hive) and
  `_impala_builtins` are left out of `schema list`, like the other engines' own schemas.
- **Hive's session sets `hive.resultset.use.unique.column.names=false`**, so `SELECT *`
  columns aren't named `table.column`. Hive still renames a second same-named column
  (`id_1`); that's reported as Hive names it.
- **Values:** `DECIMAL` stays text, `BIGINT` a number when it fits, `TIMESTAMP`/`DATE`
  the server's text, and `ARRAY`/`MAP`/`STRUCT` the server's JSON-like text, unparsed:
  Hive's map text isn't always JSON (`{1:"a"}`), and a parsed BIGINT inside would lose
  digits.
- **Verification is `live` for both.** Hive runs in CI's integration job
  (`apache/hive:4.2.1`, SQL standard authorization, a `toil_reader` account granted
  SELECT). Impala ran the same conformance suite locally against `apache/impala:4.5.3`
  (`test/db/impala/compose.yml`), but isn't in CI: it's four containers and several
  gigabytes. Hive 3.1.3 was also run locally; it reports no row counts.
- **The conformance suite gained `lacks`**, one reason per thing an engine doesn't do
  (indexes, transactions, keys it enforces, keys on an Iceberg table, NOT NULL and
  DEFAULT through the protocol, two same-named result columns, a read-only mode), and
  `TargetDatabase.reader` for the engine side of the read-only checks. Its `SELECT 1 AS
  one` became `AS x`, because Impala reserves `ONE`. The text-type check accepts
  `STRING`, Impala's only text type on Iceberg.
- **Deferred:** Kerberos (it needs a native GSSAPI module; the docs say so, with the
  error a Kerberos-only server gives), HiveServer2's HTTP transport (binary port only),
  and ZooKeeper service discovery (`host` names one server).

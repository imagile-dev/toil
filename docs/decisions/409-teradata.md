# Teradata through the Teradata Query Service (#409)

Sources relied on: Teradata's Query Service OpenAPI specification
(`Query Service OpenAPI Specification.yaml`, downloads.teradata.com, Swagger 2.0), its
copy in Teradata's `developer-resources` repository (`apis/query-service.yaml`), and
Teradata's quickstart "Send queries using REST API" (`Teradata/quickstarts`,
`modules/query-service/pages/send-queries-using-rest-api.adoc`), which points at the
Query Service Installation, Configuration, and Usage Guide. These are the brief's
references; none of the shipped docs, code or skills names them.

- **ANSI-mode sessions make every read roll back.** The spec's `SessionRequest`
  (`POST /systems/{systemName}/sessions`) takes `transaction_mode` (`DEFAULT`,
  `ANSI`, `TERA`) and `auto_commit`, and its overview says explicit sessions are for
  "a transaction [that] needs to span multiple requests". So each call opens one
  with `transaction_mode: ANSI`, `auto_commit: false` (and `default_database`,
  `log_mech` when the connection sets them), sends its statements with `session`,
  and ends with `ROLLBACK` and `DELETE /systems/{systemName}/sessions/{id}`; a write
  sends `COMMIT` first. ANSI mode was chosen over Teradata mode because there a
  transaction is open from the first statement until `COMMIT` or `ROLLBACK`, and a
  logoff rolls it back, so nothing depends on toil sending `BT` first. The docs say
  plainly that this has never run against a live service.
- **toil can't enforce read-only on Teradata, and the docs say so** (the
  maintainer's decision on the issue). `skills/toil/db.md` (Teradata connections and
  "Reads are read-only at the engine"), `docs/bounds.md` (`commands.read-only`) and
  the `databases` skill all say `db query` relies on a read-only user and that toil
  doesn't parse SQL to decide what writes. The rollback is on top of that, as on SQL
  Server.
- **An update count on a read is `WRITE_DISABLED`.** Each element of `results` says
  `resultSet: true` (rows) or false (an update count). A read that gets an update
  count changed something, which the rollback undoes; it is reported as SQL Server's
  DONE-token check reports one. A read-only user's refusal (Teradata error 3523,
  "does not have INSERT access") is `WRITE_DISABLED` too, matched on the access
  right named, so a `SELECT` refused for lack of access stays `DATABASE`.
- **Transaction control is refused anywhere in the SQL**, reads and `db execute`
  alike: `COMMIT`, `ROLLBACK`, `ABORT`, `BT`, `ET`, and `BEGIN`/`END` before
  `TRANSACTION`, and `COMMIT` except after `ON` (a temporary table's `ON COMMIT
  PRESERVE ROWS`, review on #410). They are reserved words, so outside strings, quoted names and
  comments they can only be those statements. A procedure body that commits is
  refused with the rest rather than parsed (`src/core/db/teradata/split.ts`).
- **The path is `systems/<system>/...` under a user-supplied `baseUrl`.** The spec's
  overview prose says `/system/[systemName]/queries`, while its `paths`, its own
  curl examples and the quickstart say `/systems/`; the curl examples disagree again
  on a base path (`/api/query` or none). toil uses `/systems/` and takes everything
  before it from `baseUrl`, so a site with a prefix puts it there. A 404 says to
  check both `system` and `baseUrl`.
- **Requests and answers follow the spec.** `Accept:
  application/vnd.com.teradata.rest-v1.0+json`; query bodies send `format: ARRAY`
  (the spec's enum is upper case, as the quickstart sends `OBJECT`), `include_columns:
  true`, and `params` for every catalog name, never spliced. Columns are read from
  `results[0].columns` (`name`, `type`) and rows from `data`. Responses are read in
  camelCase (`sessionId`, `queryId`) as the quickstart shows them, falling back to the
  spec's snake_case (`session_id`, `query_id`), since the two disagree.
- **Paging is the service's `row_offset` and `row_limit`.** Core asks for `limit + 1`
  rows from an offset; toil sends exactly that, and `row_limit: 0` (the spec's "no
  limit"; its default is 1000) for catalog reads. Each page reruns the query, as on
  every engine here.
- **Numbers stay exact.** The service writes BIGINT and DECIMAL as JSON numbers, so
  toil reads the body as text and parses it with a reviver that sees each number's
  source (Node 24): an integer past 2^53 becomes a BigInt (a string in the output),
  and a decimal with more than 15 significant digits keeps its text.
- **Cancelling deletes the session's queries, then the session.** The synchronous
  `POST .../queries` returns no query id until it finishes, so on an abort toil lists
  the session's queries (`GET .../queries?session=<id>`, a documented filter) and
  `DELETE`s each ("if it was running, then it has been aborted"), then closes the
  session. Those go through a new `CommandContext.cleanupFetch`: `ctx.fetch` is bound
  to the command's signal, which has just fired, so it can't send them. It is the
  same instrumented fetch without that signal, and each request has a 10-second
  limit of its own. An abort while `POST .../sessions` is still in flight leaves toil
  without the session's id, so that session waits for the service's idle timeout;
  it is a documented known limit (review on #410), since finishing the open on the
  cleanup fetch and then closing it is more machinery than a `unit` provider needs. Asynchronous queries (`spooled_result_set`) would hand back an id
  up front, but cost a spool file and polling for every read; not used.
- **429 Too Many Sessions is reported at once, not retried.** Core's 429 retry waits
  seconds; a session limit frees up when someone else's work ends. The error says the
  user has hit its session limit, that each toil call opens one session and closes it,
  and that it's retryable (`details.retryable`), with `HTTP` as its code like core's
  rate limit. 412 (session busy or queue timeout) is reported the same way.
- **Auth is Basic or a bearer token, never both.** `user` and `password` go as HTTP
  Basic; `token` as `Authorization: Bearer`, for a token the user already has (a JWT
  for a JWT-enabled database). The spec mentions an "access token issued by the Query
  Service" and a `LoginCred` definition, but documents no path that issues one, so
  toil doesn't mint or refresh tokens; an expired one is `AUTH`, saying so. `token`
  is a secret beside `password`. A token connection needs `database`, since toil
  can't learn the user's default database before the first call.
- **`logMech` is an optional key** (`TD2`, `LDAP`, `JWT`), sent as the session's
  `log_mech`, because a directory account needs LDAP and the system's default may be
  TD2. `KRB5` and `TD1` are left out: Kerberos would need a ticket toil can't get
  without the OS, and TD1 is obsolete.
- **Listings use the DBC views with names compared case-blind.** `DBC.DatabasesV`
  (minus the databases Teradata maintains, listed in the provider), `DBC.TablesV`
  (`TableKind` T, O and Q as tables, V as views), `DBC.ColumnsV`, `DBC.IndicesV` and
  `DBC.All_RI_ChildrenV`. Names are matched with `UPPER(...) = UPPER(?)`, because an
  ANSI session compares a literal case-specifically, and Teradata names aren't.
- **The primary key falls back to a unique primary index.** Teradata turns a
  `PRIMARY KEY` declared without a `PRIMARY INDEX` into the unique primary index and
  reports no `K` index for it, so `primaryKey` is the `K` constraint's columns, else
  the UPI's. Unnamed indexes are named `primary index` or `index <n>`. A foreign key's
  column order comes from the view's row order, which it doesn't document.
- **Two lint changes for Teradata.** It has `SELECT TOP n`, so `dialect-top` doesn't
  run there and `dialect-limit` does, pointing at `TOP n` or `SAMPLE n`; and
  `read-only-write` also catches `INS`, `UPD`, `DEL`, `COLLECT` and `MODIFY`.
- **No conformance target, and no Docker run.** There is no free Teradata container
  (Vantage Express is a VM). `test/db/teradata.test.ts` drives every command and
  failure through `execute()` against a stubbed Query Service, with responses
  invented from the spec and labelled so. A target for `test/db/targets.ts` waits for
  a live Query Service: it would need its own seed (Teradata has no multi-row
  `VALUES`, writes `CREATE INDEX name (col) ON table`, and refuses DDL followed by DML
  in one transaction, which the shared suite's DDL test does), so writing one now
  would ship code nobody has run.
- **Verification level `unit`** (what the issue calls `untested`): never run against
  a live instance. Raising it needs a run against a real Query Service, checking in
  particular that a session in `LOGGINGON` queues the first query rather than
  refusing it, that `auto_commit: false` holds across requests, and that deleting a
  running query aborts it.

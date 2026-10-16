# toil

One CLI and MCP server for the work around the code: your enterprise tools, your
databases, and your codebase. Every command returns structured JSON, so agents and
scripts can use it as easily as people.

> Status: early. Nothing is released yet. See [docs/plan.md](docs/plan.md).

## What it does

| Area | Examples |
|------|----------|
| `db` | List connections, describe tables, preview rows, run read-only queries with paging |
| `code` | Search symbols, find references, call hierarchy, diagnostics, build and test (.NET via Roslyn) |
| Enterprise tools | Issue trackers, source hosts, CI, scanners, observability, all with a pasted token |

## Install

```bash
dotnet tool install -g Imagile.Toil
```

Or download a single binary from [Releases](https://github.com/imagile-dev/toil/releases).

## Use

```bash
toil db query --connection reporting "select top 10 * from orders"
toil code refs --symbol OrderService.Submit
toil mcp            # run as an MCP server over stdio
```

Every command writes one JSON envelope to stdout:

```json
{ "ok": true, "data": { }, "meta": { "durationMs": 42 } }
```

## Configure

Settings resolve in this order: `TOIL_*` environment variables, then `.toil.json` in
the repository, then `~/.toil/config.json`. Database connections are read-only unless
you mark them otherwise.

## Contributing

Read [CLAUDE.md](CLAUDE.md). It holds the rules for people and agents alike.

## License

MIT © Imagile

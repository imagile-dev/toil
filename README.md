# toil

One CLI and MCP server for the work around the code: your enterprise tools, your
databases, and your codebase. Every command returns structured JSON, so agents and
scripts can use it as easily as people.

> Status: early. Nothing is released yet. See [docs/plan.md](docs/plan.md) and
> [docs/integrations.md](docs/integrations.md).

## What it does

| Area | Examples |
|------|----------|
| `db` | List connections, describe tables, preview rows, run read-only queries with paging |
| `code` | Search symbols, find definitions and references, call hierarchy, diagnostics, rename preview |
| Enterprise tools | Issue trackers, source hosts, CI, scanners, observability, all with a pasted token |

## Install

toil is plain JavaScript on Node 22 or later, on Windows, macOS and Linux. There is no
executable, no native module, and no install script, so it runs where unapproved
binaries are blocked.

```bash
npm install -g @imagile-dev/toil
```

As an MCP server, with no install step:

```json
{ "command": "npx", "args": ["-y", "@imagile-dev/toil", "mcp"] }
```

Each [release](https://github.com/imagile-dev/toil/releases) also carries the packed
`.tgz` for offline or mirrored installs: `npm install -g ./imagile-dev-toil-<version>.tgz`.

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

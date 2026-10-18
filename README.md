# toil

One CLI and MCP server for the work around the code: your enterprise tools and your
databases. Every command returns structured JSON, so agents and
scripts can use it as easily as people.

> Status: early. Nothing is released yet. See [docs/plan.md](docs/plan.md) and
> [docs/integrations.md](docs/integrations.md).

## What it does

| Area | Examples |
|------|----------|
| `db` | List connections, describe tables, preview rows, run read-only queries with paging |
| `skills` | Add a git-hosted skills marketplace, install its plugins for Codex, GitHub Copilot or Claude Code, switch them on and off |
| Enterprise tools | Issue trackers, source hosts, CI, scanners, observability, all with a pasted token |

## Install

toil is plain JavaScript on Node 24.14 or later, on Windows, macOS and Linux. There is no
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

### Run from a clone

npm is the recommended path. Where the git host is reachable but the npm registry
isn't, a clone runs as it is, with no `npm install`: `dist/toil.js` is committed, and
it is the last released toil (each release rebuilds it; nothing else changes it).

```bash
git clone https://github.com/imagile-dev/toil.git
node toil/dist/toil.js version
node toil/dist/toil.js setup alias    # PowerShell: add --profile $PROFILE
```

`setup alias` adds a `toil` function to your shell profile (`~/.bashrc`, `~/.zshrc`, or
the PowerShell profile you name), between two marker lines; `setup remove-alias` takes
it out. Open a new terminal and `toil` works. MCP clients don't read shell profiles, so
register the server as `node` with `<clone>/dist/toil.js mcp` as its arguments.

### Agent skill

[`skills/toil/`](skills/toil/SKILL.md) is toil's command reference for agents, in the
Agent Skills format, and the site's docs are the same files rendered. toil carries it
inside itself: `toil skill install --allow-write` writes it to `~/.agents/skills/toil`
(Codex, and GitHub Copilot), with `--agent github-copilot` or `--claude` for the
others and `--scope project` for the repository. Its description names the areas and
database engines you have connections for, and toil rewrites it when a connection
changes or another toil version runs, so there is nothing to update by hand. In
Claude Code it also installs from the repository's plugin marketplace:
`claude plugin marketplace add imagile-dev/toil`, then `claude plugin install toil@toil`.
The skill also tells an agent how to install toil and register `toil mcp` with its
client.

## Use

```bash
toil db query --connection reporting "select top 10 * from orders"
toil jira search --jql "project = PAY" --select "issues[].key"   # keep only part of data (JMESPath)
toil wait --until "result != null" -- jenkins pipeline get-run --name api-build --number 42   # repeat a read until it holds
toil mcp            # run as an MCP server over stdio
```

Every command writes one JSON envelope to stdout:

```json
{ "ok": true, "data": { }, "meta": { "durationMs": 42, "context": { "connection": { "value": "corp-jira", "source": "default", "default": "named" } } } }
```

## Configure

Settings resolve in this order: `TOIL_*` environment variables, then
`~/.toil/config.json`. `toil connections add <name>` sets up a connection on a
terminal and keeps its token in the OS credential store, with only a reference in
config; `toil connections list` shows what's set up (`--area <name>` for one area), and
`toil connections test <name>` checks one with a single read. Run `toil` on its own in a
terminal for a menu that does all of this, and shows each command as it runs. Tokens live in the OS
credential store or in environment variables, never in the config file; use
environment variables in CI, containers and anywhere without a credential store. Nothing in a repository can change where your credentials go or
switch on writes; `toil connections writes <name> on` asks you to type the name. Database connections are read-only unless you mark them otherwise.

Behind a corporate proxy or TLS inspection, nothing extra is needed: toil trusts the OS
certificate store as well as Node's bundled CAs, and sends requests through
`HTTPS_PROXY` / `HTTP_PROXY`, skipping hosts in `NO_PROXY`. If your organization's CA
is in neither store, point `NODE_EXTRA_CA_CERTS` at its bundle.

## Contributing

Read [CLAUDE.md](CLAUDE.md). It holds the rules for people and agents alike.

## License

Apache License 2.0 © Imagile. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

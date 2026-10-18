# toil

One CLI and MCP server for the work around the code: your enterprise tools and your
databases. Every command returns one structured JSON envelope, so agents and scripts
can use it as easily as people.

> **Status:** Alpha: APIs and flags may change before 1.0

toil is published to npm as [`@imagile-dev/toil`](https://www.npmjs.com/package/@imagile-dev/toil),
and documented at [imagile-dev.github.io/toil](https://imagile-dev.github.io/toil/). This
README is for working from a clone of this repository; the site covers everything else
in more depth.

## Quick start

Node.js 24.14 or later, on Windows, macOS or Linux. There is no executable, no native
module and no install script.

```bash
npm i -g @imagile-dev/toil
toil version
toil deps scan      # inventory the npm, Maven and NuGet packages in this folder
toil mcp            # serve toil to an agent over stdio
```

The first alpha isn't on npm yet; until it is, `npm i` fails with a 404, so run toil
from a clone (below). Setup, connections and every command are on the
[site](https://imagile-dev.github.io/toil/docs/).

## Running from a clone

`dist/toil.js` is committed, and it is the last released toil, so a clone runs as it
is, with no `npm install`. It imports only Node's built-ins.

```bash
git clone https://github.com/imagile-dev/toil.git
node toil/dist/toil.js version
node toil/dist/toil.js setup alias                    # bash or zsh
node toil/dist/toil.js setup alias --profile $PROFILE # PowerShell
```

`setup alias` adds a `toil` function to your shell profile, between two marker lines;
`setup remove-alias` takes it out. Open a new terminal and `toil version` works.
`git -C toil pull` brings the newest release, with nothing to rebuild.

### Building it yourself

The committed bundle changes only with a release. To run what's on `main` now, build
it:

```bash
cd toil
npm ci
npm run build       # writes dist/toil.js
node dist/toil.js version
```

Don't commit the rebuilt `dist/`; `git checkout -- dist/` puts the released bundle
back. [CLAUDE.md](CLAUDE.md) has the rest of the gate (typecheck, lint, tests).

### Pointing an agent at the clone

**MCP.** Clients start servers without a shell, so they don't see a `toil` alias.
Register `node` with the clone's absolute path:

```bash
claude mcp add toil -- node /path/to/toil/dist/toil.js mcp --areas jira
codex mcp add toil -- node /path/to/toil/dist/toil.js mcp --areas jira
```

or, for clients with an `mcpServers` file:

```json
{ "mcpServers": { "toil": { "command": "node", "args": ["/path/to/toil/dist/toil.js", "mcp", "--areas", "jira"] } } }
```

`--areas` limits the tools to what the task needs; without it toil serves every area
with a connection set up. [`skills/toil/mcp.md`](skills/toil/mcp.md) covers VS Code and
the rest.

**The toil skill.** [`skills/toil/`](skills/toil/SKILL.md) is toil's command
reference for agents, in the Agent Skills format. In Claude Code, the clone is a plugin
marketplace: `claude plugin marketplace add /path/to/toil`, then
`claude plugin install toil@toil`. For Codex, GitHub Copilot and anything else that
reads `.agents/skills`, copy `skills/toil` to `.agents/skills/toil` in a repository.
[`skills/toil/install.md`](skills/toil/install.md) has the other options.

## What it does

| Area | What it covers |
|------|----------------|
| [`db`](https://imagile-dev.github.io/toil/docs/databases/) | SQLite, PostgreSQL, MySQL / MariaDB, SQL Server and Oracle: list schemas and tables, describe a table, preview rows, read-only queries with paging |
| [`util`](https://imagile-dev.github.io/toil/docs/utilities/) | Local commands with no connection or network: JWTs, dependency inventories, encodings and hashes, certificates, test and coverage reports, logs, secret scans, time and versions, Jira and Confluence markup, OpenAPI |
| [`skills`](https://imagile-dev.github.io/toil/docs/skills/) | Add a git-hosted skills marketplace, install its plugins for Codex, GitHub Copilot or Claude Code, switch them on and off |
| [The toil skill](https://imagile-dev.github.io/toil/docs/) | toil's own command reference for agents, one file per area |
| [Work tracking and source](https://imagile-dev.github.io/toil/integrations/) (9) | Jira, Confluence and Bitbucket (Data Center and Cloud), GitHub & GitHub Enterprise, Azure DevOps Server, local git |
| [Build, release and runtime](https://imagile-dev.github.io/toil/integrations/) (5) | JFrog Artifactory, Jenkins, OpenShift / Kubernetes, Sauce Labs, Split.IO |
| [Security and quality](https://imagile-dev.github.io/toil/integrations/) (7) | Checkmarx One, Contrast Security, SD Elements, SonarQube, Sonatype IQ Server, Sonatype OSS Index, OSV.dev |
| [Observability](https://imagile-dev.github.io/toil/integrations/) (4) | Dynatrace, Elasticsearch, Kibana, Falcon LogScale |
| [Design and data](https://imagile-dev.github.io/toil/integrations/) (2) | Figma, Alation |

Every integration that needs a credential signs in with a long-lived token you
generate once in the vendor's UI. Every integration records how far it has been
verified: `unit`, `live` or `stable`. Each one's
page on the [integrations board](https://imagile-dev.github.io/toil/integrations/)
says what its level means.

## Contributing

Read [CLAUDE.md](CLAUDE.md). It holds the rules for people and agents alike.

## License

Apache License 2.0 © Imagile. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

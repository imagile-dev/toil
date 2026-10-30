# Map of toil

A map of this repository, kept so a question about its structure reads the map instead
of the code. It was made by the workflow page `skills/toil/workflows/map-codebase.md`,
which is also how it is refreshed.

- **Commit mapped:** `333cf9ca77a624b21b1604f44946327318ba660d`
- **toil version used:** `0.1.0-beta.3`
- **Files:** [`map.json`](map.json) (modules, edges, hubs, decisions, what is not mapped)
  and [`model.json`](model.json) (the C4 model, input to `toil util c4`)
- **Diagrams (SVG):** [context](context.svg), [containers](containers.svg),
  [components](components.svg) (the components of `core`)

Everything is **observed** (read from source or a command, cited in its description) or
**inferred** (its description starts with `(inferred)` and says why). The map has 15
observed and 2 inferred modules and 19 observed and 6 inferred edges; the model has 27
observed and 1 inferred elements and 21 observed and 11 inferred relationships.
The hubs are `core` (13 modules depend on it) and `registry` (4).

**Not mapped:** `dist/` (generated bundle), the insides of `src/areas/*` beyond each
index file's imports, tests, `ui/` and `site/` beyond folder sizes, schema JSON, and the
services toil would read at runtime (no connection). `map.json` lists each.

## System context

```mermaid
C4Context
title System context: toil

Person(engineer, "Engineer", "Installs toil from npm and runs it, or lets an agent drive it (CLAUDE.md Project)")
Person(agent, "AI agent / CI job", "Drives toil through the CLI, MCP or the ./api entry (CLAUDE.md Project)")
System(toil, "toil", "Structured-JSON CLI and MCP server over enterprise tools and databases (package.json, CLAUDE.md)")
System(toil_ui, "Toil UI", "Separate package @imagile-dev/toil-ui: React/Vite front end plus local node:http server (ui/package.json, CLAUDE.md Layout)")
System_Ext(services, "Enterprise services and databases", "Jira, GitHub, databases and the others toil talks to, at hosts in the user config (CLAUDE.md principle 9)")
System_Ext(credstore, "OS credential store", "macOS Keychain, Windows credential store, secret-tool (CLAUDE.md No Executables)")

Rel(engineer, toil, "Runs", "terminal")
Rel(agent, toil, "Calls tools on", "MCP stdio")
Rel(agent, toil, "Imports and calls execute()", "npm ./api")
Rel(agent, toil, "Runs", "terminal")
Rel(toil, services, "Sends requests to", "HTTPS, SQL")
Rel(toil, credstore, "(inferred) reads secrets from via keychain.ts", "OS tools")
Rel(toil_ui, toil, "(inferred) executes commands through toil execute()", "npm dependency")
```

## Containers

```mermaid
C4Container
title Containers: toil

Person(engineer, "Engineer", "Installs toil from npm and runs it, or lets an agent drive it (CLAUDE.md Project)")
Person(agent, "AI agent / CI job", "Drives toil through the CLI, MCP or the ./api entry (CLAUDE.md Project)")
System(toil_ui, "Toil UI", "Separate package @imagile-dev/toil-ui: React/Vite front end plus local node:http server (ui/package.json, CLAUDE.md Layout)")
System_Ext(services, "Enterprise services and databases", "Jira, GitHub, databases and the others toil talks to, at hosts in the user config (CLAUDE.md principle 9)")
System_Ext(credstore, "OS credential store", "macOS Keychain, Windows credential store, secret-tool (CLAUDE.md No Executables)")

System_Boundary(toil, "toil") {
  Container(cli, "CLI front door", "TypeScript, commander", "src/cli.ts main() and src/program.ts buildProgram; bin dist/toil.js (package.json bin)")
  Container(mcp, "MCP server", "TypeScript, MCP SDK", "src/mcp/server.ts: one tool per registry command (imported at src/cli.ts:10; tool generation per CLAUDE.md Layout)")
  Container(api, "./api entry", "TypeScript", "src/api.ts: execute(), registry, envelope types for a program in-process (src/api.ts:31 imports run.js)")
  Container(registry, "Registry", "TypeScript", "src/registry.ts lists every area and command; both front doors read it (src/registry.ts:23,34)")
  Container(core, "Core machinery", "TypeScript", "src/core: defineArea, defineCommand, execute, config, secrets, dossier, db providers, query, output (150 files, 33k lines, util size src)")
  Container(areas, "Integration areas", "TypeScript", "src/areas: 28 area folders (ls src/areas): ado, jira, github, db, util, ... 341 files, 69k lines (util size src --depth 2)")
  Container(dossiers, "Dossier commands", "TypeScript", "src/dossiers: list, show, build, onboard, brief (4 files, 1.7k lines)")
  Container(connections, "Connection commands", "TypeScript", "src/connections: add, login, list, import ... (13 files, 2.5k lines)")
  Container(skills, "Skills and bundled skill", "TypeScript", "src/skills: skills folders, marketplace clones, bundled toil skill (6 files)")
  Container(welcome, "Welcome menu", "TypeScript, ANSI", "src/welcome: splash and menu for bare toil on a terminal (38 files, 7.4k lines)")
  Container(misc, "Small modules", "TypeScript", "src/audit, feedback, theme, setup, repos, os, shims (each 1 to 4 files, imported by the root and core only)")
}

Rel(engineer, cli, "Runs", "terminal")
Rel(agent, mcp, "Calls tools on", "MCP stdio")
Rel(agent, api, "Imports and calls execute()", "npm ./api")
Rel(agent, cli, "Runs", "terminal")
Rel(cli, registry, "Builds commands from", "import src/cli.ts:14")
Rel(cli, core, "Runs calls through", "import src/program.ts:7")
Rel(cli, mcp, "Starts for toil mcp", "import src/cli.ts:10")
Rel(cli, welcome, "Opens on bare toil", "import src/cli.ts:17")
Rel(mcp, core, "(inferred) Executes each tool through", "import, 14 files")
Rel(mcp, registry, "(inferred) reads tool list from", "import")
Rel(api, registry, "Exports", "import src/api.ts:36")
Rel(api, core, "Delegates to", "import src/api.ts:31")
Rel(api, mcp, "Imports", "import src/api.ts:34")
Rel(registry, areas, "Lists via areas.generated.ts", "import src/registry.ts:1")
Rel(registry, dossiers, "Registers commands of", "import src/registry.ts:4-7")
Rel(registry, connections, "Registers commands of", "import src/registry.ts:3")
Rel(registry, skills, "Registers commands of", "import src/registry.ts:14-15")
Rel(registry, misc, "Registers commands of", "import src/registry.ts:2,8,9,13,16")
Rel(areas, core, "(inferred) Built on defineArea and execute", "import, 15 index files")
Rel(dossiers, core, "(inferred) Built on", "import, 32 imports")
Rel(connections, core, "(inferred) Built on", "import, 21 imports")
Rel(skills, core, "Built on", "import, 22 imports")
Rel(welcome, core, "Built on", "import, 16 imports")
Rel(misc, core, "Built on", "import")
Rel(areas, services, "Sends requests to", "HTTPS, SQL")
Rel(core, credstore, "(inferred) reads secrets from via keychain.ts", "OS tools")
Rel(toil_ui, core, "(inferred) executes commands through toil execute()", "npm dependency")
```

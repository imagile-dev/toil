# Bounds

A bound is a limit toil enforces on every command, whoever is driving it: a person at
a terminal, a pipeline, or an agent passing values it read somewhere. Each one exists
because a command handed the wrong value would otherwise do something nobody asked
for: send a credential to the wrong host, read a file it was never given, change what
it was only meant to read.

This page is the list. `src/core/bounds.ts` is the same list in code, and
`test/bounds.test.ts` fails when the two disagree: a bound in code with no row here,
a row here with no bound in code, or a row whose enforcement, errors or setting
don't match.

## Relaxing a bound

Only by a setting in the user's own config file (`~/.toil/config.json`, or the
`--config` file), never by an env var, a flag, a dossier or anything in a
repository, so neither an agent nor a checked-in file can loosen what constrains it
(*principle 2*). Today one bound can be relaxed:

```json
{ "version": 2, "connections": {}, "bounds": { "files": "unbounded" } }
```

Any other key under `bounds` is `CONFIG_INVALID`, so a typo can't look like it
worked. While a bound is relaxed, every envelope carries a `BOUND_RELAXED` warning in
`meta.warnings` naming the setting and the file. `config check` will show it too,
once that command exists. **Security-class bounds can't be relaxed at all.**

## The bounds

| Bound | Protects | Enforced in | Errors | Relaxed by | Security class |
|-------|----------|-------------|--------|------------|----------------|
| `files.workspace` | Files outside the folder the user chose. Every path a command reads, writes, lists or stats resolves inside one workspace, checked after realpath so `..`, symlinks and junctions can't leave it. | `src/core/files.ts` | `INVALID_INPUT` (outside the workspace), `NOT_CONFIGURED` (no workspace) | `"bounds": { "files": "unbounded" }` | No |
| `files.own` | toil's own config and credentials: `~/.toil/` and the `--config` file. A command handed that path would otherwise send every connection's token to its own host. Holds with the workspace bound relaxed. | `src/core/files.ts`, `src/node-context.ts` | `INVALID_INPUT` | No | Yes |
| `files.system` | `/proc` and `/sys`, where `/proc/<pid>/environ` holds the env vars that carry tokens. | `src/core/files.ts` | `INVALID_INPUT` | No | Yes |
| `files.no-overwrite` | Files already on disk. A write to an existing file is refused, bound relaxed or not; a read-only command's file name often comes from whoever uploaded it. | `src/core/files.ts` | `INVALID_INPUT` | No | Yes |
| `credentials.host` | Credentials reaching a host the user didn't configure. Requests are built from the connection's `baseUrl`, and a server-supplied URL on another host is re-pointed at it, with a warning. | `src/core/rest.ts`, `src/areas/jira/attachments.ts` | None (re-pointed, with a warning) | No | Yes |
| `secrets.storage` | Secrets sitting in a file. A secret comes from the OS credential store or an env var; a plaintext one in config is refused. | `src/core/connection.ts` | `CONFIG_INVALID` | No | Yes |
| `commands.cli-only` | Commands that prompt a person or change connections. They're never MCP tools, so an agent can't call them. | `src/mcp/server.ts` | None (not listed) | No | Yes |
| `commands.time-limit` | A caller waiting forever. Every command stops at `TOIL_TIMEOUT_MS` (default 120 s) and on Ctrl+C or an MCP cancel. The limit can be set, not removed. | `src/core/run.ts` | `TIMEOUT`, `CANCELLED` | No | No |
| `commands.read-only` | Data a read was never meant to change. A write needs `writes: true` on the connection and `--allow-write` on the call; reads send only GET/HEAD/OPTIONS (the parity suite checks), and git runs with optional index writes off. | `src/core/run.ts`, `src/core/git.ts` | `WRITE_DISABLED` | No | Yes |
| `process.spawn` | The machine's other programs. toil runs only the OS credential store and git (#68 decision 1): absolute path found by toil, no shell, fixed argv, the repository-config hooks that run code turned off. | `src/core/git.ts`, `src/core/keychain.ts`, `scripts/check-pure.mjs` | `GIT_NOT_FOUND` | No | Yes |

## Exceptions

| Exception | To bound | Enforced in | What it allows |
|-----------|----------|-------------|----------------|
| `git.read-up` | `files.workspace` | `src/core/git-repo.ts`, `src/core/git-config.ts`, `src/core/files.ts` | Reading git metadata above or beside the workspace, to find the repository root, branch and remotes, and what a listing skips. |

`git.read-up` is metadata only, and read only. It covers the `.git` folder or file
found by walking up from the workspace, the folders it points at (`gitdir:` and
`commondir`, so a linked worktree's metadata in another checkout), the user's global
git config (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config`, or `GIT_CONFIG_GLOBAL`),
the files those `include` or `includeIf`, git's global excludes file, and the
`.gitignore` files between the repository's top and the workspace. Nothing read this
way is returned as file content: it yields a root path, a branch name, remote URLs,
and the decision to skip a path. The files a command reads or writes stay inside the
workspace (#68 decision 2).

## Which folder is the workspace

In order:

1. `--workspace <dir>`
2. `TOIL_WORKSPACE`
3. On the CLI, the working directory
4. Under `toil mcp`, the client's root, when it shares exactly one

Otherwise there is none, and any command that touches a file refuses with
`NOT_CONFIGURED` and says how to set one. `toil mcp` never falls back to its own
working directory: an MCP client starts the server wherever it likes, often the
user's home folder, and that isn't a decision anyone made about what an agent may
read. Relative paths resolve against the workspace, and every saved path in output is
absolute, with forward slashes.

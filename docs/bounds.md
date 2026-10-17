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

Only by a setting in the config file toil loads (`~/.toil/config.json`, or the one
`--config` names). No env var, flag, dossier or repository file sets a bound's
value, so neither a tool input nor a checked-in file can loosen what constrains
an agent (*principle 2*). Today one bound can be relaxed:

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
| `files.own` | toil's own config and credentials: `~/.toil/` and the `--config` file. A command handed that path would otherwise send every connection's token to its own host. Holds with the workspace bound relaxed, for `--output-file`, and for git metadata read above the workspace. | `src/core/files.ts`, `src/node-context.ts`, `src/core/git-config.ts` | `INVALID_INPUT` | No | Yes |
| `files.system` | `/proc` and `/sys`, where `/proc/<pid>/environ` holds the env vars that carry tokens. Holds everywhere `files.own` does. | `src/core/files.ts`, `src/core/git-config.ts` | `INVALID_INPUT` | No | Yes |
| `files.no-overwrite` | Files already on disk. A write to an existing file is refused, bound relaxed or not; a read-only command's file name often comes from whoever uploaded it. | `src/core/files.ts` | `INVALID_INPUT` | No | Yes |
| `credentials.host` | Credentials reaching a host the user didn't configure. Every request is built from the area's request hook and the connection's `baseUrl`; a URL on another origin is refused before anything is sent. A redirect to another origin is refused, whatever the auth header; a GET may opt into following a signed download URL with every header dropped. A server-supplied URL on another host is re-pointed at the configured one with `repointUrl`, with a warning. A token exchange goes only to the connection's origin, or over HTTPS to a host under the vendor domain the area names in its code. | `src/core/api.ts`, `src/core/rest.ts` | `HTTP` (another origin, a redirect away), `AUTH` (a token host off the connection) | No | Yes |
| `secrets.storage` | Secrets sitting in a file. A secret comes from the OS credential store or an env var; a plaintext one in config is refused. | `src/core/connection.ts` | `CONFIG_INVALID` | No | Yes |
| `commands.cli-only` | Commands that prompt a person or change connections, and area commands marked `mcp: false` (deletes). They're never MCP tools, so an agent can't call them. | `src/mcp/server.ts` | None (not listed) | No | Yes |
| `commands.time-limit` | A caller waiting forever. Every command stops at `TOIL_TIMEOUT_MS` (default 120 s, or a longer `timeLimitMs` the command declares) and on Ctrl+C or an MCP cancel. The limit can be set, not removed. | `src/core/run.ts` | `TIMEOUT`, `CANCELLED` | No | No |
| `commands.read-only` | Data a read was never meant to change. A write needs `writes: true` on the connection and `--allow-write` on the call; reads send only GET/HEAD/OPTIONS (the parity suite checks), and git runs with optional index writes off. | `src/core/run.ts`, `src/core/git.ts` | `WRITE_DISABLED` | No | Yes |
| `process.spawn` | The machine's other programs. toil runs only the OS credential store and git (#68 decision 1): absolute path found by toil, no shell, fixed argv, the repository-config hooks that run code turned off. | `src/core/git.ts`, `src/core/keychain.ts`, `scripts/check-pure.mjs` | `GIT_NOT_FOUND` | No | Yes |

## Exceptions

| Exception | To bound | Enforced in | What it allows |
|-----------|----------|-------------|----------------|
| `git.read-up` | `files.workspace` | `src/core/git-repo.ts`, `src/core/git-config.ts`, `src/core/files.ts` | Reading git metadata above or beside the workspace, to find the repository root, branch and remotes, and what a listing skips. Anything under `~/.toil`, the `--config` file, `/proc` or `/sys` is refused: a global config or `include`/`includeIf` naming one is skipped with a `GIT_INCLUDE_REFUSED` warning in `meta.warnings`, and a `gitdir:` pointing at one is not a repository. |
| `output-file` | `files.workspace` | `src/node-context.ts`, `src/program.ts` | The global `--output-file` flag writing the envelope outside the workspace. |

`git.read-up` is metadata only, and read only. It covers exactly these, and nothing
else:

1. **`.git`**: the `.git` folder or file found by walking up from the workspace, and
   the folders it points at (`gitdir:` and `commondir`, so a linked worktree's
   metadata in another checkout). Inside it: `HEAD`, refs, `packed-refs`, `config`,
   `config.worktree`, `index` and `info/exclude`.
2. **The global git config and its includes**: `~/.gitconfig` and
   `$XDG_CONFIG_HOME/git/config` (or `GIT_CONFIG_GLOBAL` alone), and every file
   those and the repository's config pull in with `include` or `includeIf`.
3. **Parent `.gitignore` files**: those between the repository's top and the
   workspace.

Every one of these, after realpath, passes the same checks as a file a command is
handed: nothing under `~/.toil`, the `--config` file, `/proc` or `/sys`. A refused
include or global config is skipped with a `GIT_INCLUDE_REFUSED` warning, and a
`gitdir:` pointing at one is not a repository. git's global excludes file
(`core.excludesFile`) isn't on the list, so a listing doesn't apply it. Nothing read
this way is returned as file content: it yields a root path, a branch name, remote
URLs, and the decision to skip a path. The files a command reads or writes stay
inside the workspace (#68 decision 2).

`output-file` is the one file flag outside the workspace. `--output-file` is a CLI
flag, never an MCP input, so the person running the command chose the path. It may
write anywhere except toil's own files and `/proc` and `/sys`, and it never
overwrites a file. The path is checked before the command runs, so a refused path
means nothing ran; the error envelope goes to stdout, with exit code 1. If the write
still fails afterwards, a write command's error says it ran and the change may
already have been applied.

Over MCP, the config file, and so any relaxed bound, is the one `toil mcp` was
started with (`toil mcp --config <file>` in the MCP client's settings, written by a
person). No tool input can name a config file: input is strict, so a `config`
field is `INVALID_INPUT`.

Two things this doesn't cover, said plainly:

- **git itself sees the whole repository.** A command that runs git runs it in the
  workspace, but git answers for the repository it finds there: a revision such as
  `HEAD:../other/file`, or `git log -p` from a subfolder, can show content from
  outside the workspace. The git area's commands decide which pathspecs and
  revisions they accept; nothing in core confines them yet.
- **Clean and smudge filters still run, and a repository can bring its own.** The
  spawner turns off what repository config can make git run on a read (fsmonitor,
  external diff, textconv, signature checks, the pager), but not filter drivers. A
  `filter.<name>.clean` command can be set in the repository's own `.git/config`,
  and a `.gitattributes` in the tree selects it, so `git status` and `git diff` in a
  workspace that arrived with its `.git` folder (an archive of a checkout, a CI
  artifact, a vendored folder) run whatever program that config names. The `-c`
  overrides can't name every filter. git 2.40's `--attr-source` could point
  attributes at an empty tree and switch them all off, but that's above the 2.24
  floor, so for now this is a known risk of running a git command in a repository
  you didn't clone yourself.

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

---
name: secrets
description: Rules for how toil stores, resolves and moves secrets (API tokens, passwords, connection strings, any credential). Use when changing `toil connections add`, `login`, `list` or `remove`, `keychain:` references, the OS credential store in src/core/keychain.ts (macOS `security`, Windows PowerShell advapi32, Linux `secret-tool`), the `--plaintext` option, the terminal prompter, or any code that reads, writes, migrates or logs a secret. Also when adding `config init`, `config set` or `config import`, which follow the same rules.
---

# Secrets

A secret key on a connection (one an area lists in `defineArea({ secrets })`)
resolves from, highest first: its env var, then a `keychain:<ref>` reference in
config, then a plaintext value in config.

**The OS credential store is the default home for every secret toil writes.**
`toil connections add <name>` and `toil connections login <name>` read the secret
without echo and put it in the store, writing only `keychain:<connection>.<key>`
to the config file. A plaintext secret on disk needs an explicit `--plaintext`.
Anything added later that writes secrets (`config init`, `config set`,
`config import`) does the same.

## The store

`src/core/keychain.ts` is the only module in toil allowed to spawn a process
(**No Executables** in CLAUDE.md). It runs only what the OS ships, each behind a
platform check, under the service `toil` with the reference name as the account:

| Platform | Program | Store |
|----------|---------|-------|
| macOS | `security` (`-i`, secret hex-encoded on stdin) | login Keychain |
| Windows | `powershell.exe` (`pwsh` if absent), a constant script calling advapi32 `CredRead`/`CredWrite`/`CredDelete`, request as JSON on stdin | Credential Manager, target `toil:<ref>` |
| Linux | `secret-tool` | Secret Service (GNOME Keyring, KWallet) |

- Secrets travel to the store's process on stdin, never argv. Nothing is spawned
  through a shell; arguments are an array of fixed strings and a reference name
  checked against a strict pattern first.
- The spawner is injectable (`createSecretStore({ platform, spawn })`). Unit tests
  stub it for every platform, and `test/harness/fake-store.ts` stands in for the
  store in command tests. **No test touches a real store.**
- Where no store is available, a write fails with a `CREDENTIAL_STORE` error whose
  fix names `TOIL_CONN_<NAME>_<KEY>` or `--plaintext`.

## Rules

- An unresolvable reference is treated as unset, never sent as a literal. The area
  then reports the key as missing, and `meta.warnings` carries
  `CONFIG_SECRET_UNRESOLVED` naming `toil connections login <name>` and the env var.
- Env vars still win (**Configuration Precedence** in CLAUDE.md): an env var replaces
  the stored value before references resolve, so the store isn't even asked. Nothing
  may *require* the store: CI runners and containers configure entirely through env
  vars, and plaintext config keeps working.
- Commands never see the store. Only `defineConfigCommand` commands get it, through
  `ctx.manage`; an area command gets its resolved connection and nothing else.
- Anything that moves a secret leaves it in at least one place at every step:
  store it and read it back (`storeVerified`), then rewrite config, and only then
  remove the old copy (a plaintext value goes with the rewrite; an old store entry
  is deleted after it, and only when nothing else in config refers to it).
- Config writes go through `writeConfigFile`: version 2, every key not prompted for
  carried through, written alongside and renamed into place, mode 0600 in a 0700
  folder where the platform has POSIX modes.
- `toil connections list` never prints a value except the host. It reports where
  each value came from: `env`, `ci`, `file`, `store` or `defaults`.

## Prompting

Only the setup commands prompt, and only on a terminal (stdin and stderr both
TTYs); prompts go to stderr so stdout stays one envelope. Without a terminal they
fail with a fix naming the `TOIL_CONN_<NAME>_*` variables. They ask for exactly the
keys the area declares, secrets hidden, so a token area is never asked for a
username and password (the Authentication Bar in the `integrations` skill).
Setup commands are `cliOnly`: never MCP tools, since stdin is the protocol there and
agents never create or change connections.

## Verifying

The unit suite proves the invocations. A change to `keychain.ts` also needs a live
round trip on the platform you're on, in the PR: add a throwaway connection with a
fake token against a temp `--config`, show the entry in the store and only the
reference in config, use it, remove it, and show the store is clean. Say which
platforms were not run.

---
name: secrets
description: Rules for how toil stores, resolves and moves secrets (API tokens, connection strings, any credential). Use when changing `config init`, `config set` or `config import`, `keychain:` references, the OS credential store calls (macOS `security`, Windows PowerShell advapi32, Linux `secret-tool`), the `--plaintext` option, or any code that reads, writes, migrates or logs a secret.
---

# Secrets

Secrets resolve from env vars, then keychain references, then plaintext config.

**The OS credential store is the default home for every secret toil writes.**
`config init`, `config set` and `config import` put secrets in the store and write
only a `keychain:` reference to the config file. A plaintext secret on disk needs
an explicit `--plaintext`. The store is whatever the OS already ships: `security` on
macOS, PowerShell (advapi32) on Windows, `secret-tool` on Linux. Where no store is
available, the write fails with a fix naming `--plaintext` or the env var.

- Secrets travel to the store's process on stdin, never argv.
- An unresolvable reference is treated as unset, never sent as a literal.
- Env vars still win (**Configuration Precedence** in CLAUDE.md), and nothing may
  *require* the store: CI runners and containers configure entirely through env vars.
- Anything that moves a secret leaves it in at least one place at every step:
  verify the write, then rewrite config, and only then remove the old copy.

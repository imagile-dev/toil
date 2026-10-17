---
name: toil
description: Use toil, a structured-JSON CLI and MCP server, to read and change enterprise tools (Jira Data Center and more) for the user. Use when a task needs data from, or a change in, one of the services below; every command prints one JSON envelope.
---

# toil

toil gives you one interface to the enterprise tools this machine is configured for.
Every command prints exactly one JSON envelope on stdout:

```json
{ "ok": true, "data": { }, "error": null, "meta": { "command": "jira get-issue", "durationMs": 120, "version": "1.0.0" } }
```

On failure `ok` is `false`, `data` is `null`, and `error` carries a `code`, a `message`
and a `fix` you can act on. Run `toil <area> <command> --help` for any command's flags.

Reads are always allowed. A command that changes something needs `writes: true` on
the connection, set by the user, and `--allow-write` on the call. Pass `--allow-write`
only when the user asked for that change.

## Areas

| Area | Service | Reference |
|------|---------|-----------|
| `jira` | Jira Data Center: issues, search, transitions, comments, worklogs, attachments, custom fields, boards and sprints | [jira.md](jira.md) |

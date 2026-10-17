# Command contract

`command-contract.json` freezes the command surface of the CLI toil succeeds, captured
from that CLI's own `--help` output (version 6.3.0: 443 commands, 368 of them leaves).
The rule it backs, from **Migration Compatibility** in the `integrations` skill
(`.claude/skills/integrations/SKILL.md`): moving a skill, script
or pipeline to toil takes one case-insensitive find-and-replace of the old name with
`toil`.

## What has to match

For every command in scope:

- the same command path (`jira get-issue`, `ado pr list`, `dynatrace entities list`)
  and the same aliases
- the same positional arguments in the same order
- the same long and short flags, the same accepted values, and the same defaults
- group-level flags where the old CLI had them (`bitbucket --project --repo`,
  `github --owner --repo`, `ado --collection --organization --project --repo`,
  `jenkins --instance`, `openshift --env --instance`, `dynatrace --env`)
- the global flags `--pretty`, `--verbose`, `--debug`, `--config <path>`,
  `--output-file <path>`, `-v/--version`
- the JSON envelope, with the same `data` field names for the same command
- env vars and config keys, apart from the `TOIL_` prefix

toil may add commands, flags and output fields.

## Scope

| Area | In scope | Notes |
|------|----------|-------|
| Every integration (`jira`, `bitbucket`, `github`, `confluence`, `sonar`, `sde`, `ado`, `jenkins`, `artifactory`, `checkmarx`, `contrast`, `sonatypeiq`, `openshift`, `dynatrace`, `logscale`, `elasticsearch`, `kibana`, `splitio`, `figma`, `alation`, `saucelabs`) | Yes | Exact match |
| `git` | Yes | Exact match, implemented in pure JS (reading `.git` directly or through a pure-JS git library), apart from `git credentials`, below |
| `jwt` | Yes | Exact match |
| `deps` | Yes | Two divergences, below |
| `config` | No | Rebuilt around the OS credential store. `config import` migrates the old global config once. |
| `skills`, `doctor` | No | Rebuilt for toil's own skill and setup story |

## Divergences

Each entry says why it diverges (a principle, or a deliberate product decision) and what to use instead. Anything not
listed here must match exactly, and the contract test (`test/contract.test.ts`) fails on an unlisted difference. It
reads the code spans in this table's first column: a command path (`git credentials`), a command and flag
(`<area> <command> --<flag>`), or a global flag (`--dry-run`) allows that one difference. It checks every
registered area's paths, aliases, positional arguments and flag spellings; output field names aren't in the
captured contract, so each port checks those against the predecessor by hand. A divergence in behavior only, with
the surface unchanged, keeps its first column free of code spans, so it can't excuse a missing command or flag.

| Old | toil | Why |
|-----|------|-----|
| `deps frisk --source all` | Run each source separately: `toil deps frisk --source osv`, `--source sonatype`, `--source sonatypeiq` | *Principle 3*: no command fans out to several services on the caller's behalf. Single-source `deps frisk` stays, as a thin alias over the per-source commands (`toil osv vulns`, `toil ossindex vulns`, `toil sonatypeiq evaluate`). |
| `deps connectivity` | Removed. Check each source with its own `config test` | *Principle 3*: it decides on the caller's behalf which services to contact. |
| `git credentials` and its subcommands (`inspect`, `mappings`, `stored`, `forget`) | Removed. Use git's own `git credential` commands; toil checks its own credentials per area with `config test` | *Principle 1*: they work by asking the git binary (`git credential fill`/`reject`, `ls-remote`), and toil runs no executables. |
| jira schema --example-only printing the bare example with no envelope | The flag stays; the example comes back as `data` in the usual envelope. Save `.data` to use it as an `--input-file` | *Output Contract* (CLAUDE.md): every command writes exactly one envelope, so an agent never has to guess which shape stdout holds. |
| jira download-attachment fetching the attachment's content URL, with the token, from whatever host Jira names | The token goes only to `baseUrl`'s origin: a `content` URL on another host has its path and query re-pointed at `baseUrl`, with a `JIRA_ATTACHMENT_HOST` warning | **Security** (*principle 9*): a server-supplied URL must not carry the user's credential to a host they didn't configure. The one kind of behavior change a port makes before a live run (CLAUDE.md, Porting). |
| jira download-attachment reporting saved with the platform's separator | `saved` uses forward slashes on every platform; the file lands in the same place | *Principle 8* (CLAUDE.md, Cross-Platform): paths in JSON output are identical on Windows, macOS and Linux. Same on macOS and Linux as before. |
| File arguments (--input-file, --jql-file, --fields-file, --file, --dir, @file values) reading or writing any path | A path at or under `~/.toil/` or the `--config` file, or under `/proc/` or `/sys/`, is refused with `INVALID_INPUT`, after resolving `..`, symlinks and junctions | **Security** (*principle 2*): a path an agent passes must not turn a read into a way to send toil's config or the environment's tokens to a service's host. |
| Global `--dry-run` | Removed. Run the command without `--allow-write`, which refuses the write | It could only intercept writes made over HTTP, showed only the first of several, and saw little use. Writes are governed by the two-step gate (writes enabled in config plus `--allow-write`) alone. |

## Recapturing

The contract changes only on purpose, when a newer version of the old CLI shipped
commands toil should also cover. To recapture:

```bash
node scripts/capture-command-contract.mjs <path/to/old-cli/dist/cli.js> > docs/command-contract.json
```

Review the diff like any other contract change.

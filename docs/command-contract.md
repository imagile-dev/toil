# Command contract

`command-contract.json` freezes the command surface of the CLI toil succeeds, captured
from that CLI's own `--help` output (version 6.3.0: 443 commands, 368 of them leaves),
and the field names of the `data` each command returns, read from its TypeScript
source by the type checker.
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
| `git` | Yes | Exact match, apart from the divergences in `docs/divergences/git.json`. The commands spawn git, the one optional exception (decision 1 on #68), and return `GIT_NOT_FOUND` without it; the repo root, branch and remotes are read in pure JS |
| `jwt` | Yes | Exact match |
| `deps` | Yes | Two divergences, below |
| `config` | No | Rebuilt around the OS credential store. `config import` migrates the old global config once. |
| `skills`, `doctor` | No | Rebuilt for toil's own skill and setup story |

## Divergences

Each divergence is one entry in `docs/divergences/<area>.json` (`global.json` for global
flags and behavior every area shares), one file per area so parallel ports never edit
the same file. The contract test (`test/contract.test.ts`) loads them all and fails on
any difference none of them allows. An entry holds:

| Key | Meaning |
|-----|---------|
| `allows` | The identifiers it excuses: a command path (`git credentials`), a command and flag (`<area> <command> --<flag>`), a global flag (`--dry-run`), or a command and output field (`<area> <command> data.<field>`, such as `jira search data.issues[].key`). Empty for a divergence in behavior only, with the surface unchanged, so it can't excuse a missing command, flag or field. |
| `old` | What the old CLI did |
| `toil` | What toil does instead, and what to use |
| `why` | The reason, in a sentence or two |
| `principle` | The principle's number, a CLAUDE.md section (`Output Contract`), or `decision` for a deliberate product call |
| `class` | `security` when it keeps a credential or a file safe. Those are made before any live run and are never relaxed. |

Every identifier must name something in the contract and sit in the file for its own
area, and the test checks both. The test covers paths, aliases, positional arguments,
flag spellings and output field names. For output, it runs every example in the area's
fixture and requires every required field of one of the old command's recorded shapes;
optional fields (`?` in the contract) and output the old code typed as `any` can't be
checked that way, so a port still compares those with the predecessor by hand.

To read them all as a table: `node scripts/divergences.mjs`.

## Recapturing

The contract changes only on purpose, when a newer version of the old CLI shipped
commands toil should also cover. Recapture from a checkout of that version, built and
with its dependencies installed, so the checker can resolve its types:

```bash
node scripts/capture-command-contract.mjs <repo>/dist/cli.js --source <repo> > docs/command-contract.json
```

Review the diff like any other contract change.

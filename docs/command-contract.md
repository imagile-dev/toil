# Command contract

`command-contract.json` is toil's hand-maintained record of its command surface: every
command path and alias, each command's positional arguments and flags with their
accepted values and defaults, and the field names of the `data` each command returns. It holds 443
commands, 368 of them leaves. `test/contract.test.ts` checks the registered CLI against
it on every run, so a command, flag or output field can't change or disappear without
someone noticing. Each difference toil makes on purpose is a divergence, listed with its
reason (below).

How integrations are held to it is **The command contract** in `CLAUDE.md`, and the
working rules are **Compatibility** in the `integrations` skill
(`.claude/skills/integrations/SKILL.md`).

## What the contract records

For every command in scope:

- the command path (`jira get-issue`, `ado pr list`, `dynatrace entities list`) and its
  aliases
- the positional arguments, in order
- the long and short flags, their accepted values and their defaults
- group-level flags (`bitbucket --project --repo`, `github --owner --repo`,
  `ado --collection --organization --project --repo`, `jenkins --instance`,
  `openshift --env --instance`, `dynatrace --env`)
- the global flags `--pretty`, `--verbose`, `--debug`, `--config <path>`,
  `--output-file <path>`, `-v/--version`
- the JSON envelope, with the `data` field names each command returns
- env var names, each with the `TOIL_` prefix, and config keys

toil may add commands, flags and output fields; anything the contract records that toil
changes or drops is a divergence.

## Scope

| Area | In scope | Notes |
|------|----------|-------|
| Every integration (`jira`, `bitbucket`, `github`, `confluence`, `sonar`, `sde`, `ado`, `jenkins`, `artifactory`, `checkmarx`, `contrast`, `sonatypeiq`, `openshift`, `dynatrace`, `logscale`, `elasticsearch`, `kibana`, `splitio`, `figma`, `alation`, `saucelabs`) | Yes | Exact match |
| `git` | Yes | Exact match, apart from the divergences in `docs/divergences/git.json`. Repository facts (root, branch, remotes) are read from `.git` in pure JS; `status`, `diff`, `log`, `branch` and `report` run the git on PATH, the one program besides the OS credential store toil may run (#68 decision 1), and return `GIT_NOT_FOUND` without it |
| `jwt` | Yes | Built as `util jwt decode`, a local utility; `jwt decode` is its alias. One divergence, in `docs/divergences/jwt.json` |
| `deps` | Yes | `scan` and `diff` are built as `util deps scan` and `util deps diff`, local utilities, with the contract's paths as aliases; `frisk`, `outdated` and `license-check` are aliases of the source commands that own them. Divergences in `docs/divergences/deps.json` |
| `config` | No | Built around the OS credential store. `config import` reads a global config file in the shape the contract records, once. |
| `skills` | Yes | Marketplace add, list, plugins, remove, sync, enable and disable, and `skills status`, matched. The rest aren't built yet, or are gone for good (`skills git-auth`); each is a divergence in `docs/divergences/skills.json` |
| `doctor` | No | Built for toil's own setup story |

## Divergences

Each divergence is one entry in `docs/divergences/<area>.json` (`global.json` for global
flags and behavior every area shares), one file per area so parallel integrations never edit
the same file. The contract test (`test/contract.test.ts`) loads them all and fails on
any difference none of them allows. An entry holds:

| Key | Meaning |
|-----|---------|
| `allows` | The identifiers it excuses: a command path (`git credentials`), a command and flag (`<area> <command> --<flag>`), a global flag (`--dry-run`), or a command and output field (`<area> <command> data.<field>`, such as `jira search data.issues[].key`). Empty for a divergence in behavior only, with the surface unchanged, so it can't excuse a missing command, flag or field. |
| `when` | Optional. Input values a call must have for the entry to apply, such as `{ "exampleOnly": true }`. The output check applies it per example, so `jira schema`'s fields are excused only with `--example-only`. |
| `old` | What the contract records |
| `toil` | What toil does instead, and what to use |
| `why` | The reason, in a sentence or two |
| `principle` | The principle's number, a CLAUDE.md section (`Output Contract`), or `decision` for a deliberate product call |
| `class` | `security` when it keeps a credential or a file safe. Those are made before any live run and are never relaxed. |
| `removed` | `true` when the command paths in `allows` are gone from toil, not changed (`git credentials`). `allows` then lists only command paths. The test accepts their absence, and fails if one of them, or a path under it, is still registered. |

Every identifier must name something in the contract and sit in the file for its own
area, and the test checks both. The test covers paths, aliases, positional arguments,
flag spellings and output field names; a flag on the command's group counts for a leaf
flag of the same spelling, since the group accepts it after the leaf. For output, it runs every example in the area's
fixture and requires every required field of one of the contract's recorded shapes;
optional fields (`?` in the contract) and output the contract types as `any` can't be
checked that way, so an integration still compares those with the contract by hand.

To read them all as a table: `node scripts/divergences.mjs`.

## Changing the contract

The contract is edited by hand and changes only on purpose, in the same change as the
commands it records. Review the diff like any other contract change.

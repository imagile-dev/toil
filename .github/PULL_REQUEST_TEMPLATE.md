## What this does

<!-- What changes and why, as the PR is now. Rewrite this after every review round you act on. -->

Closes # (or Refs # when more PRs will follow for the same issue)

## How it was verified

<!-- CLAUDE.md, Delivery: proof a human can check, not just "tests pass". -->

- **Gate** (OS, Node version): the summary lines from `npm run typecheck`, `lint`, `test`, `build`, `check:pure` and `smoke`
- **Real runs**: the commands you ran, CLI and MCP, with the envelopes they returned (placeholders only)
- **Screenshots**, for anything visual: desktop and 375px
- **Not verified**, and why:

## Checklist

- [ ] Conventional Commit title (`fix:`, `feat:`, `docs:`, `chore:`)
- [ ] Placeholder hosts and IDs only (`<service>.imagile.dev`, `abc12345`)
- [ ] `dist/` untouched (only the release PR changes it)
- [ ] Docs and the toil skill (`skills/toil/`) updated in the same PR, where the change needs it

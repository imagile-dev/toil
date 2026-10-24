# Contributing to toil

Thanks for wanting to make toil better. [CLAUDE.md](../CLAUDE.md) holds the rules
for people and agents alike, and it wins wherever this page is shorter than it.

## Before you start

- **Bugs and ideas start as an issue.** Use the
  [issue forms](https://github.com/imagile-dev/toil/issues/new/choose), or the
  [feedback page](https://imagile-dev.github.io/toil/about/feedback/) on the site.
- **Security problems never do.** See [SECURITY.md](SECURITY.md).
- **A new integration** has to clear the Authentication Bar first: a long-lived
  token the user generates once in the vendor's UI, with no browser step, OAuth
  dance or other CLI between that token and a request. The `integrations` skill
  under `.claude/skills/` has the full rule.

## Setting up

Node.js 24.22.1 or later on 24.x, or 26.12.1 or later, on Windows, macOS or Linux.

```bash
git clone https://github.com/imagile-dev/toil.git
cd toil
npm ci
npm run build
node dist/toil.js version
```

Don't commit the rebuilt `dist/`: only the release PR changes it, and CI fails any
other PR that does. `git checkout -- dist/` puts the released bundle back.

## Making a change

- **Branch** as `kolatts/<issue#>-<description>` for maintainers; from a fork, any
  branch name works.
- **Commit** with [Conventional Commits](https://www.conventionalcommits.org/):
  `fix:`, `feat:`, `docs:`, `chore:`. release-please writes the changelog from them.
- **Size** a PR as one vertical slice (core, CLI, MCP, tests, skill doc) that is
  fully verified before it opens.
- **Keep the rules** that matter most here:
  - no executables, native modules, install scripts or runtime dependencies
  - writes need `writes: true` on the connection and `--allow-write` on the call
  - placeholder hosts only: `<service>.imagile.dev`, IDs as `abc12345`, email as
    `you@example.com`
  - every command returns one JSON envelope, on the CLI and over MCP alike

## The gate

All six pass before a PR opens. CI runs them on Windows, macOS and Linux, on
Node 24.22.1 and 26.12.1.

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check:pure
npm run smoke
```

## Verify before you open a PR: `npm run verify:ui`

A change under `ui/` also runs Toil UI's own gate (`npm run typecheck -w ui`, `lint`,
`test`, `build`, `check:package`, `check:lockfile` and `smoke`, each with `-w ui`),
and then `npm run verify:ui`. That one command builds Toil UI, runs every view on
sample data and on the real sandbox repository through the layout and accessibility
check at 375, 768 and 1440px, and writes `ui/.verify/report.md` with screenshots
beside it. Add `-- --ask` when the change touches the agent: it also asks Codex one
question and checks the answer's citations, its proposals, and that nothing ran.
The real-data part needs the GitHub CLI signed in with access to
`imagile-dev/toil-sandbox`; without it, the report says that part was skipped. Paste
the report's table into the PR. [ui/README.md](../ui/README.md) has the details.

## Review and merge

- PRs from a branch of this repository get an automated review from the Imagile
  Bot, against CLAUDE.md, once they're out of draft; PRs from a fork are reviewed by
  a maintainer. Fix every finding, including the non-blocking ones, and reply in
  each thread with what changed.
- The PR description says how you verified the change: the gate's summary lines
  with your OS and Node version, real runs of the commands you touched, and
  screenshots for anything visual.
- A person decides every merge. A maintainer merges a contributor's PR. `main`
  needs an approving review of the head commit and the `CI ok` check, and takes
  squash merges only.

## License

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](../LICENSE), the same as toil.

# toil and Toil UI move to beta (#478)

- **Remove `release-as` once `0.1.0-beta.1` is out.** `release-please-config.json`
  sets `"release-as": "0.1.0-beta.1"` on both packages, once, so release-please
  doesn't count on from `alpha.5` / `alpha.3`. Left in, it forces the same version on
  the next release PR. `test/release-workflow.test.ts` (**drops a release-as override
  once that version is released**) fails as soon as `.release-please-manifest.json`
  reaches the forced version, with the fix in its message. It skips on the release PR
  (`GITHUB_HEAD_REF` starting `release-please--`), which is what moves the manifest,
  and in `publish-toil` (`GITHUB_JOB`), which runs `npm test` on the release's tag
  before publishing. So after the release PR merges, `main`'s CI and every PR fail
  until a PR deletes both `release-as` lines. A loud red check was chosen over a
  workflow that edits the config by itself, which would need write access the release
  job doesn't otherwise use.
- **The dist-tag script is unchanged.** It already takes the word after the hyphen, so
  `0.1.0-beta.N` publishes under `beta` and moves `latest` while `latest` is missing or
  a prerelease. The new test runs the publish step's own script in bash, with `npm` a
  stub function, for beta, a later beta, an alpha, a beta after a stable `latest`, and
  a stable release, rather than restating the logic in JavaScript. Where bash isn't on
  PATH the block is skipped, and its name says so (principle 8).
- **Toil UI's pin and order are unchanged.** The node-workspace plugin moves Toil UI's
  exact pin to `0.1.0-beta.1` in the release PR, `publish-ui` still needs
  `publish-toil` and waits for npm to serve the pin, and the `lockfile` job still
  follows. Nothing in `scripts/wait-for-npm.mjs` or the lockfile job names a
  prerelease word.
- **Status wording.** "Alpha: APIs and flags may change before 1.0" becomes "Beta:
  commands, flags and output are stable, and any breaking change comes with a
  migration note", on the README, the site's home, how it works, and
  `skills/toil/install.md`, since the old line says the opposite of the beta
  commitment.
- **The CSS class `start__alpha` is renamed `start__beta`**, with its one use, so the
  site's source doesn't keep a stale name.
- **Left as alpha, because it's history or not about the release stage:** version
  numbers in tests and fixtures (`0.1.0-alpha.N` envelopes, the stale-session and
  lockfile tests, `whats-new` ordering), `ui/README.md`'s notes on what needed which
  past toil (`newer than 0.1.0-alpha.3`, the stale example), `ui/docs/live-runs/`,
  the README's sample run of the released `0.1.0-alpha.2`, `docs/repo-settings-proposal.md`'s
  record of tags that exist, "a themes folder from an earlier alpha" in `ui/server/`
  and `ui/README.md` (it's about folders those alphas left), Maven's `alpha < beta`
  ordering in `skills/toil/util.md`, a git remote named `alpha` and a connection named
  `alpha` in tests, and canvas or colour alpha in `ui/src/ambient/`,
  `ui/src/game/PowershellMan.tsx`, `ui/scripts/layout-check.mjs`,
  `scripts/gen-wordmark.mjs` and `site/src/components/ImagileMark.astro`.
- **Reshapes after the beta.** The command contract section and the `integrations`
  skill now say a reshape from the first beta on is a breaking change under principle
  7, with the old path kept and a deprecation warning where practical. Principle 10
  still says reshaped paths are "dropped, not kept as aliases"; this PR may edit only
  principle 7, so that tension is left for the maintainer.

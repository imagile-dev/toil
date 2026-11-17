# Windows, macOS and Node 26 in CI on every PR (#605)

The maintainer chose the option (2026-11-17): both gates on every OS on every PR,
with Toil UI's layout check left to Linux. These are the decisions made in carrying
it out.

- **One job per OS and Node line, not split like Linux.** Five jobs (Windows and
  macOS on 24.22.1 and 26.12.1, Linux on 26.12.1) bring a run to 18 jobs, inside
  GitHub Free's 20 at once, with 2 of macOS's 5. Splitting each into a toil job and a
  Toil UI job would have meant 23 jobs, so a run would queue on its own. Measured on
  the daily run, toil's and Toil UI's tests take 3 to 10 minutes on Windows and
  macOS, so one job lands near the Linux layout shards' 5 to 9.
- **`--no-layout` on the UI smoke**, a flag for this alone. With it the smoke still
  installs both tarballs offline, checks the server's Host, Origin, cookie and Fetch
  Metadata gates, runs the live SQLite store and the wipe, which are the parts that
  depend on the OS. It refuses to be combined with `--shard`.
- **Lint and `check:lockfile` stay on Linux only.** They read the same files on every
  OS. Typecheck runs everywhere, since it's 20 seconds and a path or case problem
  shows there first.
- **Toil UI's steps follow the scope check** (a docs-and-config PR skips them, as it
  skips the Linux UI jobs), and toil's steps always run, as toil's Linux gate does.
  `CI ok` takes only `success` from these jobs, because they never skip.
- **`platforms.yml` stays as the daily backstop**: the whole smoke with the layout on
  every OS, and the skill install. It no longer runs on pull requests, so the release
  PR runs only `ci.yml`, which now covers every OS and `check:dist` on each.
- **Time limits on every job**: 5 minutes for the small ones, 20 for the gates, 25 for
  a layout shard, 30 for the database job and the new jobs, 120 for a daily job
  (the longest passing one took 87 minutes), 15 for a skill install. A hang on Nov 16
  ran for GitHub's six hours, and the failure was never filed.

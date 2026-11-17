# Windows, macOS and Node 26 in CI on every PR (#605)

The maintainer chose the option (2026-11-17): both gates on every OS on every PR,
with Toil UI's layout check left to Linux. These are the decisions made in carrying
it out.

- **One job per OS and Node line, not split like Linux.** Five jobs (Windows and
  macOS on 24.22.1 and 26.12.1, Linux on 26.12.1) bring a run to 19 jobs with a peak
  of about 18 at once (`CI ok` runs last), inside GitHub Free's 20, with 4 of
  macOS's 5. Splitting each into a toil job and a Toil UI job would have meant 23 at
  once, so a run would queue on its own. The limit is per account, so a merge's push
  run and the release PR's new run share it and queue, as they already did. From the
  daily run's step times, the Windows job comes to about 12 minutes, a few longer
  than the Linux layout shards' 5 to 9, which makes it a run's longest job.
- **`--no-layout` on the UI smoke**, a flag for this alone. With it the smoke still
  installs both tarballs offline, checks the server's Host, Origin, cookie and Fetch
  Metadata gates, runs the live SQLite store and the wipe, which are the parts that
  depend on the OS. It refuses to be combined with `--shard`.
- **Toil UI's layout check per PR on Linux only** is a trade of cost for a day's
  delay, not a claim that every OS renders alike: fonts, text metrics and scrollbars
  differ, and the daily run checks every OS.
- **Lint and `check:lockfile` stay on Linux only.** They read the same files on every
  OS. Typecheck runs everywhere, since it's 20 seconds and a path or case problem
  shows there first.
- **Toil UI's steps follow the scope check** (a docs-and-config PR skips them, as it
  skips the Linux UI jobs), and toil's steps run whenever the scope check passed.
  `CI ok` takes only `success` from these jobs, since they skip only when the scope
  check failed, and says when Toil UI's steps were skipped on a docs-and-config PR.
- **`platforms.yml` stays as the daily backstop**: the whole smoke with the layout on
  every OS, and the skill install. It no longer runs on pull requests, so the release
  PR runs only `ci.yml`, which now covers every OS and `check:dist` on each.
- **Time limits on every job**: 5 minutes for the small ones, 20 for the gates, 25 for
  a layout shard, 30 for the database job and the new jobs, 150 for a daily job
  (the longest passing one took 99 minutes), 15 for a skill install. A hang on Nov 16
  ran for GitHub's six hours, and the failure was never filed: a job past its limit
  ends as cancelled, which `failure()` doesn't see. The daily report now runs on a
  failed or a cancelled job.

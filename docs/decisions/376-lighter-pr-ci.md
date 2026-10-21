# 376: Linux on every PR; Windows, macOS and Node 26 daily

- **PRs and `main` run CI on Linux, Node 24.14, as two parallel jobs**: toil's gate and Toil UI's. Seven PRs pulled main at the same moment and queued about 80 jobs against the account's ~20-runner limit (5 on macOS). Approved PRs waited an hour or more. The maintainer asked for simple PR jobs, with the other platforms on a daily schedule.
- **`platforms.yml` runs the old full matrix** (three OSes × Node 24.14 and 26, plus skill install on each OS): daily at 06:17 UTC, on demand, and on the release PR. The release PR publishes, so every platform passes there before anything ships. A failed daily run opens one `platforms-failure` issue, and later failures comment on it instead of opening more.
- **Principle 8 is unchanged.** Windows and macOS are still first-class, and a break there gets fixed. What changed is when it's caught: within a day, not on every PR.
- **`CI ok` keeps its name**, so the ruleset doesn't change. It now needs both gates, the integration job and the dist guard.
- **The layout check runs its theme schemes in parallel**, one headless Chrome per core (`LAYOUT_WORKERS` overrides). Run one after another, it took 16–18 minutes of the 21-minute job. Findings are joined in scheme order, so the report reads the same however many workers run.

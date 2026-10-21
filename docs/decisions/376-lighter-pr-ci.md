# 376: A lighter CI matrix on pull requests

- **On a pull request, the gate runs every OS on the Node floor (24.14) only.** Main pushes and the release PR also run Node 26. Seven PRs pulled main at the same moment and queued about 80 jobs against the account's ~20-runner limit (5 on macOS), which held approved PRs for an hour or more. Every OS stays first-class (principle 8) on every PR. A break that only Node 26 hits shows on main's push run, and on the release PR before anything publishes.
- **Skill install runs on Linux for a PR and on every OS on main.** It's optional, outside `CI ok`, and downloads a third-party CLI. The cross-OS install path is covered on main.
- **`CI ok` keeps its name and its needs**, so the ruleset doesn't change. A smaller matrix still has to pass in full.

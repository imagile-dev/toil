# Local git (`git`)

Wave 3 · Integration issue #25 · Suspected bugs #74 · 10 contract commands

## Commands

- **Ported, spawning git:** `git status`, `git diff [--staged] [--file]`, `git log [--count] [--since]`, `git branch`, `git report [--branch] [--base] [--since] [--until] [--csv]`
- **Moves:** `git current-pr` becomes `bitbucket current-pr`, and `git current-pr` stays as an alias to it (decision 1). It belongs to the Bitbucket port.
- **Removed:** `git credentials inspect | mappings | stored | forget`, already listed in `docs/divergences/git.json`.

## Auth

None. No server, no config keys. `current-pr` uses the Bitbucket connection once it moves.

## Paging

None. `log` limits with `-n <count>` (default 10). `diff` stops parsing after 5000 lines of git output. `report` reads the whole range.

## Special HTTP needs

No HTTP. Local operations, per decision 1:

- **Pure JS (core, K3):** the repo root, HEAD and current branch, and the remotes. The predecessor got these from `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref HEAD` and `git remote -v`, run in the process working directory. `git remote -v` prints URLs after `url.<base>.insteadOf` rewriting, so the pure-JS reader must apply `insteadOf` to match.
- **Spawned through `src/core/git.ts`:** fixed argv, no shell, `--` before paths, `-c core.fsmonitor=`, no pager, `GIT_TERMINAL_PROMPT=0`, the command's abort signal. With no git on PATH these commands return `GIT_NOT_FOUND`.
- **`status`:** `git status --porcelain` (v1). Columns X and Y at positions 0 and 1, the path from position 3. `??` is untracked; X not space or `?` is staged; Y likewise is unstaged; a file can be in both.
- **`diff`:** `git diff [--staged] [-- <file>]`, parsed into `{files: [{path, binary, truncated, hunks: [{oldStart, oldCount, newStart, newCount, lines}]}], truncated}`. Path from `diff --git a/(.+) b/.+$`; `Binary files` sets `binary`; counts default to 1. Inside a hunk only lines starting `+`, `-` or space are kept (so `\ No newline at end of file` is dropped); the `---`/`+++` headers come before the first `@@`, when no hunk is open, and are skipped.
- **`log`:** `git log --format=%H<US>%an<US>%aI<US>%s [-n N] [--since=<since>]`, US being `\x1F`. Returns `[{hash, author, date, message}]`.
- **`branch`:** `git branch -a`. A leading `*` marks current; `remotes/` entries go to `remote` with the prefix stripped.
- **`report`:** `git log --format=<marker>%H\t%an\t%aI\t%s --numstat [--since=] [--until=] [range]`, with a 200 MB buffer. Range is `base..branch`, `base..HEAD`, or `branch`. Plain `YYYY-MM-DD` dates are sent as `YYYY-MM-DDT00:00:00+00:00`. Numstat `-` counts as 0. The branch name falls back to `rev-parse --abbrev-ref HEAD`, then `HEAD`. The marker is internal and never shown.
- **CSV (decision 4):** `--csv` now writes to a workspace file with `--out <file>`, never overwriting, and the envelope returns the saved absolute path. The predecessor printed raw CSV to stdout instead of the envelope; listed in `docs/divergences/git.json`. Header `week,week_start,author,commits,insertions,deletions,net_lines,files_changed`, one row per week and author, then a `TOTAL` row; fields with `,` `"` CR or LF are quoted.

## Context inputs

- The repo is found from the working directory. Outside a repo every command fails with "Not a git repository", exit 1.
- `report --branch` defaults to the current branch. No flag reads config.

## Supported version

Not established for git itself. #74 confirmed the porcelain leading space on git 2.49. The Node floor is 24.14 (decision 3 on #68, set in #105).

## Watch for

- **Report filtering:** after git's committer-date `--since/--until`, absolute dates are filtered again by author date (`%aI` first 10 characters). Relative values are left to git. Weeks are Monday to Sunday in UTC with ISO week labels `YYYY-Www`; authors and weeks are sorted by `localeCompare`.
- **Error swallowing:** `diff`, `log` and `report` catch every git failure and return an empty result (#74 items 4, 6, 9); `status` and `branch` let it fail. Decided: `GIT_NOT_FOUND` overrides the swallow (a missing git must be an unmistakable error), listed in `docs/divergences/git.json`. Every other git failure keeps the predecessor's behavior, pinned.
- **Pin from #74:** item 1 (output is trimmed, so the first status line loses its leading space and one path character), 2 (renames as `old -> new`, quoted paths kept quoted), 4 (a large diff gives no files and `truncated: false`), 5 (diff path regex on quoted paths, `noprefix`, `mnemonicPrefix`, ` b/` inside a path), 6 (`--count 0` returns the whole history), 7 (`branch` mangles worktree markers, detached HEAD and `remotes/origin/HEAD -> ...`), 8 (`--until` excludes the until day), 10 (UTC weeks).
- **Forced divergences:** item 3 (the shell-string `diff` breaks on paths with spaces) disappears with a fixed argv, and `--no-ext-diff`/`--no-textconv` change `diff` output in repos that configure them. The safeguard flags are listed in `docs/divergences/git.json`; add item 3 there too when porting.
- **Item 11** (`current-pr` returns `ok: true` with a `message` when Bitbucket is unconfigured, and ignores GitHub) travels with the move to Bitbucket.

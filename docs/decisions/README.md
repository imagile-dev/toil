# Agent decisions

Decisions an agent makes by default, under the maintainer's standing instruction
(2026-10-17): take the recommended option, prefer the simpler one, and write each one
down, so the maintainer can review any of it and overturn it. The maintainer's own
decisions stay on the issues.

**One file per PR**, named after its branch without the `kolatts/` prefix:
`kolatts/361-review-churn` writes `docs/decisions/361-review-churn.md`. A PR adds its
own file and edits only that one, so two PRs never touch the same file and never
conflict here. Several PRs for one issue each have their own branch, so each gets its
own file.

Each file has one title (`# <what the change is> (#<issue>)`) and a bulleted list.
Each entry says what was decided, why, and where it applies, in the same voice as
CLAUDE.md. A skipped review finding is a decision too: say what was skipped and why.

A review of agent decisions reads every file here. A file whose decisions have all
been settled (kept, made a principle, or reversed) is deleted in the PR that settles
them, so what's left is what's still open.

Everything decided before #361 is in `AGENT_DECISIONS.md` at the repository root,
frozen as an archive. Code comments cite it as `AGENT_DECISIONS.md, #<n>`; cite a
file here by its path (`docs/decisions/361-review-churn.md`).

This line is a throwaway edit for the merge-only proof on #361; the PR carrying it is closed unmerged.

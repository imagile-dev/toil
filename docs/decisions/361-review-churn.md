# Less review churn on merges of main (#361)

- **A merge-only push is re-approved by a script, not reviewed by the agent.**
  `claude-review.yml` runs `scripts/review/merge-only.mjs` before the agent step, on
  `synchronize` only. It approves only when the bot's last formal review approved a
  commit, that approval stands or GitHub dismissed it as stale on a push, no thread is
  open, every first-parent commit since is a merge whose other parent is on the base
  branch, and the PR's own diff against its merge base is unchanged. Anything else,
  an error included, runs the full review, with a warning when it was an error.
- **The diff comparison ignores where a hunk sits, never what it says.** The `@@`
  line numbers and a text file's whole-file blob ids are blanked, because a merge of
  `main` moves both whenever `main` changed the same file elsewhere, which would send
  most merges to a full review. Changed lines, context lines and whitespace are
  compared byte for byte, and a binary file's section is compared whole, since its
  delta depends on the whole pre-image. When `main` changed a PR hunk's context, that
  is a full review: the conservative side.
- **Blanking hunk line numbers leaves one narrow gap, accepted.** A merge commit
  could move a PR hunk to another place in the same file whose three context lines
  happen to be identical, and the diffs would still match: same file, same order,
  same content and context. That adds nothing for someone with push access, who can
  already change `claude-review.yml` or run test code with the App token (the review
  bot's note on #368).
- **The checker runs from the base branch's copy**, so a PR can't change the code
  that decides whether it skips review. The cost is that a PR changing the checker
  only takes effect once merged. A PR can still change `claude-review.yml` itself,
  which `pull_request` runs from the PR; that limit is the same as for every other
  step in the job (same-repo heads only, the `automation` skill).
- **An approval GitHub kept on the head is checked against the last real commit.**
  On the scratch PR (#366), GitHub moved the bot's approval to the merge commit and
  reported it at the head's sha in REST and GraphQL alike, so the commit it was given
  at can't be read back. The step then takes the newest first-parent commit that
  isn't a merge of the base as A and posts nothing. That is stricter than the true A
  when a reviewed merge changed the PR, which only costs a full review.
- **A dismissal with a message is never treated as stale.** GitHub's dismissal on
  push has no message and names the pushed commit; a person's dismissal and the
  bot's own "Superseded by a newer automated review" both carry a message, so neither
  is undone by a merge.
- **`AGENT_DECISIONS.md` is frozen as an archive** rather than split into one file
  per issue. Splitting 5,000 lines by hand risks losing entries, and code comments
  cite the file by name; keeping it whole keeps every citation valid.
  `test/repo-hygiene.test.ts` pins its content, so an agent that appends out of habit
  fails the gate with a message naming the new folder.
- **Other files every PR touches** were checked over the last 60 merges: after
  `AGENT_DECISIONS.md` (47 of 60), `CLAUDE.md` (23) and `ui/README.md` (20) are the
  most edited. Neither is append-only; edits land in different sections and rarely
  conflict, so they are left as they are.

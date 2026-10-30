# Map-codebase page run on toil, with its map committed (#529)

- **The map lives in `docs/map/`, not `.toil/map.json`.** `.toil/` holds dossiers, and
  a new top-level folder needs the hygiene allowlist. `docs/` is already allowed and
  GitHub draws the Mermaid in `docs/map/README.md` inline. The page now proposes
  `docs/map/map.json` with the model beside it, and still lets the person pick.
- **Files are `map.json`, `model.json`, three SVGs and a README**, without the commit
  in their names, so a refresh replaces them in one PR. `render --out` never
  overwrites, so a refresh renders under a new name and then replaces the committed file.
- **Schema.** `c4` is `{ "model": "<path>" }`. `changedWith` holds module ids only;
  a co-change read from commit scopes is marked with `changedWithHow` and
  `changedWithReason` on the hub. Map ids are the model's element ids. `commit` is the
  repository's, not toil's own build commit.
- **Dropped from the first run's map:** its free-text `refresh` block, which described
  a refresh from another commit and has no place in the schema. A refresh is the
  procedure on the page, and the file records only the commit it describes.
- **Added to the first run's map:** the `registry` to `misc` and `core` to `credstore`
  edges, which the model already carried, so the two files agree.
- **`git report` is dropped from the page.** It returns per-commit counts and weekly
  totals, and no files or scopes, so it added nothing to a map that `git log` did not.
- **Workspace.** The page says the repository is the workspace and that every file
  toil reads or writes is inside it, and offers a different `--workspace` for the
  `util c4` commands when the repository should not hold the model.

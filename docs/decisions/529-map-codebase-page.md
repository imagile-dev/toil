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
- **`verification: unit` stays.** The page was run cold on toil and on one other
  repository, but the Confluence placement, and a refresh through the page's own
  incremental steps (changed paths to modules, re-scan only those files), were not run.
- **Scan bound.** Scan the entry, index and largest files first, and a whole module only
  where its edges matter; an edge beyond the scanned files is marked inferred. Chosen so
  a large repository's map costs a handful of commands, not one per file.
- **No git, no refresh shortcut.** Without git there is no changed-file list, so the page
  says to re-map from step 1 rather than guess what changed.
- **Hub counts follow the map's own edges** (the page's definition: other modules with an
  edge into it), so `core` is 10 and `registry` 2 (`cli`, `api`). The earlier 13 and 4
  counted imports, not modules.
- **Review round: every inferred edge was settled by scanning.** `mcp` to `registry` was
  refuted (`src/mcp` never imports the registry; `src/cli.ts:86` hands it the commands) and
  dropped, along with the model's `core_run` to `core_db` (`src/core/run.ts` does not import
  `core/db`). `ui_server` to `core`, `ui_web` to `ui_server`, `site` to `feedback_fn`,
  `core` to `credstore` and `areas` to `services` were confirmed from the files and are
  observed. Per-module counts were redone with `util size <file> --select outline.imports`
  and now say files and imports apart (`areas`: 198 files, 518 imports, not 15 index files).
  The only inferred item left is the hub's co-change, read from commit scopes.
- **The map and model agree on how** for every edge and module, checked by script.
  An external system has no `path`.

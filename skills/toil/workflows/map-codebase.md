---
job: map-codebase
description: Map a repository without reading every file, model it as a C4 diagram, draw it, and keep the map so the next question reads the map instead of the code. Use for "map this codebase", "draw its architecture" or "onboard me to this repository".
role: any
needs: {"optional": ["git", "dynatrace", "openshift", "artifactory", "confluence"]}
inputs: [{"name": "repository", "dossier": true}, {"name": "map file", "dossier": false}, {"name": "placement", "dossier": false}]
writes: ["confluence page update", "confluence page attach"]
loop: none
verification: unit
---

# Map a codebase

Rules every page shares: `workflows/README.md`. The result is a map of a repository, a
C4 diagram built from it, and a file that keeps both. The map is built from
what commands return, never from reading every file. Onboarding someone is this page,
then `toil dossiers brief` and how to run the repository's gate; it needs no page of its own.

## Steps

1. **Map.** Gather facts, each remembered with the file and line or the command it
   came from.

   ```bash
   toil util size . --depth 2 --top 20
   toil util size <one-of-the-largest-files>
   toil util deps scan
   toil git log --count 200 --since "3 months ago"
   toil git report --since 2026-01-01
   toil dossiers show
   toil util openapi list <spec-file>
   ```

   `util size` gives the tree and sizes, and an outline (functions, classes, line
   ranges) of one file at a time, so read the outlines of the largest files and
   only the parts you need. When `util size` lists imports, take each file's import
   edges from there; until then, take them from manifests and folder structure.
   `deps scan` finds manifests and so the entry points and packages; `git log` shows
   which areas change often, by the scope in each commit message (it lists no files,
   so mark a hot spot read this way as inferred). The dossier names the repositories
   and services around this one. Read the repository's recorded reasoning, ADRs and
   decision files (`docs/adr/`, `docs/decisions/`), and link each to the modules it names.

   Group modules by their real boundaries: packages, manifests, top-level folders.
   Don't group by guess.

2. **Model.** Build or refresh a C4 model (context, containers, and components where
   they are clear) from the map and the dossier. Add runtime facts only where they are
   connected:

   ```bash
   toil dynatrace service list
   toil openshift deployment list
   toil artifactory build list
   ```

   The model's format is in `util.md`, **toil util c4**. Every element and every
   relationship is either **observed** (read from source or a command, citing the file
   and line or the command) or **inferred** (your reading, with the reason). The model
   has no field for it yet, so begin the `description` of an inferred element or
   relationship with `(inferred)`; the diagram then shows it and nobody takes a guess for
   a fact. Find the **hubs**: the modules most others depend on, and the ones most often
   changed together, so a reader knows where everything flows and where to start.

3. **Draw and place.** One view at a time.

   ```bash
   toil util c4 render <model.json> --view containers --out <new-file>.svg
   toil util c4 mermaid <model.json> --view context
   toil util c4 d2 <model.json> --view components
   ```

   `render --out` never overwrites a file, so a refresh needs a new name. Propose where
   it goes and write it only on the person's yes: the repository's `docs/` (Mermaid
   draws inline on GitHub), or a Confluence page. For Confluence, Data Center takes
   `toil confluence page update <id> --body-file <file> --markdown --allow-write`;
   Cloud takes storage format, from `toil util md <file> --to storage`, saved and sent as
   `--body-file`. Attach the SVG with `toil confluence page attach <id> --file <svg> --allow-write`.

4. **Keep the map.** Write one JSON file at a path the person picks (propose
   `.toil/map.json` in the repository), with the agent's own file tools:

   ```json
   { "schemaVersion": 1, "toilVersion": "<toil version>", "commit": "<sha mapped>",
     "modules": [{ "id": "core", "path": "src/core", "how": "observed", "source": "package.json" }],
     "edges": [{ "from": "cli", "to": "core", "how": "inferred", "reason": "folder naming" }],
     "hubs": [{ "id": "core", "dependents": 12, "changedWith": ["cli"] }],
     "decisions": [{ "file": "docs/decisions/12-x.md", "modules": ["core"] }],
     "notMapped": ["dist/", "vendored/"], "c4": {} }
   ```

   `<toil version>` is `toil version`, and `<sha mapped>` is the first hash from
   `toil git log --count 1`. A later run reads the file and refreshes only what changed
   since that commit: the changed file names come from `git diff --name-only <commit>`
   in your own git, since toil's `git diff` shows only staged or working changes. Answer
   questions from the file rather than the code. `--select` works on a toil command's
   output, not on a file, so query the file with your own tools.

## Done when

The person has the diagram or has chosen where it goes, the map file is written where
they said, and the report says what was not mapped.

## Report

1. The map in a few lines: modules, hubs, entry points.
2. How much of it is observed and how much inferred, and the commit it describes.
3. What wasn't mapped: generated code, vendored folders, languages `util size` has no
   outline for.
4. Three questions worth asking next, each answerable from the map.

## Never

- Read every file, or present an inference as observed.
- Overwrite a diagram or the person's file without asking, or write to Confluence
  without a yes.
- Parse with anything but toil's commands and your own reading: no new dependency.
- Map folders you were not pointed at, or send repository contents anywhere.

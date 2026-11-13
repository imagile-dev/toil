# A toil project keeps its architecture diagram, and Toil UI draws it (#582)

The maintainer asked for a better "Draw its architecture": the diagram kept in the
person's own toil storage, and drawn as a picture rather than printed as Mermaid text.
These are the calls an agent made where that left room.

- **One diagram per toil project, at `~/.toil/diagrams/<toil-project>.json`.** Why: it
  is what the request named (the project's storage, at user level), it sits beside
  `~/.toil/projects/` and `~/.toil/classify/`, and one file per name needs no index.
  The file holds the C4 model with how each thing is known, a revision, when it was
  saved and by which toil, and what was left unmapped. A diagram is keyed by the toil
  project's `name`, the first one the catalog resolves, as everything else is; removing
  a toil project keeps its diagram and says so (`DIAGRAM_KEPT`). Where:
  `src/core/diagrams.ts`; bounds `diagrams.write` and `diagrams.replace`.
- **How a thing is known lives in the C4 model, not beside it.** Every person, system,
  container, component and relationship may carry `how` (`observed` or `inferred`),
  the evidence for an observed one and the `reason` for an inferred one. Why: evidence
  kept in a second list drifts from the element it supports, and `util c4` can then
  draw it. The names follow the map file the map-codebase page already keeps (`how`,
  `source`, `reason`). A relationship's evidence is `evidence`, because its `source`
  is already the element it starts from; on a computed view's edge it is `source`.
  Additive: a model that says nothing renders byte for byte as before.
- **A stored diagram holds no address and nothing shaped like a secret.** `save`
  refuses a URL (`<scheme>://`) or a token-shaped value in any string, by path. Why:
  a diagram is a document that gets handed around, and a fact should cite the file or
  command it came from. This is stricter than `util c4 render`, which still draws a
  model that names a URL. The checks run on write only, so a hand-edited file can
  still be shown and removed. Overturn it if real diagrams need to name an external
  system's public address.
- **`projects diagram check` exists so the agent meets every refusal before the
  person is asked.** It runs exactly what `save` runs and keeps nothing. Why: a
  refusal that first appears on the person's press arrives when no agent is left to
  fix the model.
- **`save` is served over MCP; `remove` is CLI only.** A diagram holds no secret, host
  or `writes`, so saving one is a local write like `projects analyze set` and needs no
  `--allow-write`; a delete is never an MCP tool. `save` records only the SHA-256 of
  the model in the audit log.
- **`show --view` returns the computed view, not a layout.** `data.view` is what the
  view shows (boundary, elements, arrows), the same thing every renderer is handed.
  Why: returning coordinates would make the layout's internals a contract (principle
  7). Whoever draws lays it out.
- **`util c4` reads a toil envelope piped into it.** `toil projects diagram show
  payments --select model | toil util c4 render -` works because the reader takes the
  model from a successful envelope's `data`. Additive: anything that was a valid model
  is read as before.
- **Toil UI draws the picture itself, from toil's layout, with no Mermaid.** The page
  imports toil's own layered layout from source (it is pure and has no dependency) and
  draws React SVG. Why: Mermaid is a large runtime dependency that the package rules
  rule out, injected SVG markup can't be clicked or themed, and a picture drawn from
  the layout can show sources one step in. The page applies the same box and arrow
  limits `util c4 render` does, since the layout runs on the page rather than in
  toil's bounded worker.
- **The job's Save press takes the model from the agent's last passing check, not
  from its answer.** Why: a model the agent retypes into its answer can differ from
  the one toil checked. The answer is prose; the card saves through `/api/config`
  with `projects diagram save --replace`, on the person's press.
- **The page is one step in from the Summary, not a tab**
  (`#/project/<name>/summary/diagram`), reachable from the header link, the Summary's
  links and the command palette, to fit the shell the work-classification branch is
  moving to.
- **The card replaces only a diagram it knows is kept.** It reads `projects diagram
  show` first; the button says "Replace the saved diagram" and sends `--replace` only
  then. Why: a replace the person wasn't told about is a surprise, and toil's refusal
  names the diagram if one appeared meanwhile.
- **Two C4 colours carry black text in Toil UI.** The notation's white text on the
  container blue (3.5:1) and the external grey (2.9:1) fails WCAG AA, so the page
  draws those two with black text, and a test holds every pair to 4.5:1. toil's own
  SVG (`util c4 render`) keeps the notation's colours unchanged.
- **`/api/config` takes a body up to toil's own diagram cap** (4 MiB, plus room for
  the envelope), where every other route keeps 256 KB. Why: a model is sent whole on
  the Save press.
- **A draft is offered only while the chat that made it is open.** The worklog keeps
  an answer's text, not its model, so a run reopened from history shows no Save
  rather than a dead one. Saving from history would mean keeping drafts in the
  cache; left for later.
- **A fenced block in a job's answer is folded** into a closed disclosure, in job
  answers only, so text an agent pastes anyway is never the answer's face.
- **With sample data the card saves nothing and says so,** linking to the sample's
  stored diagram.
- **`scripts/triage/changes.mjs` lists `diagrams` among the safety layers,** because
  `test/triage.test.ts` holds it to every path the bounds name.

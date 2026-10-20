# Dossier pages that preview the work, and editing a dossier in place (#342)

- **`toil dossiers describe` replaces without `--replace`.** Every other dossier edit
  refuses to change a value that is already set unless `--replace` is passed. A name and
  a description only ever replace, and the command exists to change them, so asking
  for `--replace` on every call would add a flag that guards nothing.
  (`src/dossiers/build.ts`)
- **It refuses any dossier outside your own folder, with the `toil dossiers import`
  fix.** The issue says other dossier writes do this; they don't (`link`, `field` and
  the rest edit a checked-in dossier in place). `describe` does, because a rename would
  otherwise move a teammate's file out of a repository. The others are unchanged here.
- **A name taken in your own folder is refused; one taken in a listed folder or a
  repository is a warning,** as `init` does, since yours takes precedence there.
- **The description is one line:** line breaks in what's typed become spaces, and an
  empty one is refused. There is no way to clear it (a delete would be CLI only, like
  `wip-limit --clear`); nobody asked for one.
- **A rename writes the new file first, then deletes the old one,** so a refusal or a
  crash leaves the dossier where it was. A file already named for the new name that
  holds this dossier (`pay.json` holding "payments") is rewritten in place.
- **Renaming carries Toil UI's own records over, on the server, after toil renames.**
  The issue asked that anything referring to the dossier by name keeps working. Each is
  moved by `/api/config` once `dossiers describe` returns `renamed` (`ui/server/main.ts`):
  - **The cache** (`Cache.rename`): every row of every per-dossier table moves in one
    transaction; each stored response is re-keyed, since its key is its input and the
    input names the dossier; agent runs and envelopes that name it are rewritten. Rows
    left under the new name by a removed dossier go first.
  - **The worklog:** its pages are folded from the cache, so after the cache moves the
    pages are folded again under the new name, and the old name's folder, which no
    dossier holds any more, is removed by the same reconcile that removes a forgotten
    dossier's.
  - **Assignments** (`AssignmentQueue.renameDossier`): each moves, is saved, and says so
    in its transcript; what it started on keeps the old name, which is what it was.
  - **This browser's "last looked" record** moves on the page.
  - What toil itself holds needs nothing: the sections, people and environments are in
    the file. The audit log keeps the old name on old lines, as a log should.
  - A rename is refused (409) while a sync or an assignment of that dossier runs, since
    both read it by name as they go. A step that fails is a `TOIL_UI_RENAME` warning on
    toil's result, never a failed call, since toil has already renamed the file.
- **The cards read each dossier the way its dashboard does** (`loadDossier` through the
  same `execute()`, which the local app answers from the cache), one dossier at a time,
  and keep the result, so a dashboard opened from a card is already loaded. A summary
  endpoint on the server would be fewer requests, but would be a second reading of the
  cache that the preview, which has no server, couldn't run; one loader keeps the card
  and the dashboard from disagreeing.
- **"Changed since you last looked"** counts work items and pull requests whose
  `updated` is after this browser last opened the dossier's dashboard, kept in
  `localStorage` beside the theme. It isn't kept on the server: it's one viewer's
  convenience, and nothing else reads it.
- **The lead card:** the dossier opened most recently in this browser; before any was,
  the one with the most in progress, blocked and waiting on review, chosen only once
  every card has loaded so it doesn't jump; and a lone dossier. It spans two columns
  from 48rem. The Dossiers view's `main` widens to 1680px; every other view keeps 1280px.
- **The pencil is quiet in every theme.** Themes frame their buttons, and a framed box
  beside every name and description was a lot of boxes, so the pencil drops the frame
  and keeps a 2rem target, past WCAG 2.2's 24px.

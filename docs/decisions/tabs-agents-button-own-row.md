# Dossier tabs: the Agents button takes its own row below 1200px

- **What:** below 1200px, where the Agents sidebar is a drawer, its button sits on its own line above the dossier tabs instead of beside them.
- **Why:** beside them at 375px it took a third of the row, leaving room for about two tabs; the other five were reachable only by scrolling a 229px strip. The tabs now get the whole row and scroll with their edge cue only when they must.
- **Where:** `ui/src/views/dossier-shell.css`; the layout check gained `tabs-squeezed` / `tabs-covered` for a `data-tabs-row`.
- **What:** on real data, the layout check's `audit-lines` state passes when the Usage page says "No command failed in this window". **Why:** a real home can genuinely have no failed command, so there is nothing to open, and verify:ui failed for that reason alone. The sample always has failures, so it still must open some. **Where:** `states()` in `ui/scripts/layout-check.mjs`, which takes `headerFits` as its sample flag.

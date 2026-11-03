# Dossier tabs: the Agents button takes its own row below 1200px

- **What:** below 1200px, where the Agents sidebar is a drawer, its button sits on its own line above the dossier tabs instead of beside them.
- **Why:** beside them at 375px it took a third of the row, leaving room for about two tabs; the other five were reachable only by scrolling a 229px strip. The tabs now get the whole row and scroll with their edge cue only when they must.
- **Where:** `ui/src/views/dossier-shell.css`; the layout check gained `tabs-squeezed` / `tabs-covered` for a `data-tabs-row`.

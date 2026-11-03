# Dossier tabs: the Agents button takes its own row below 1200px

- **What:** below 1200px, where the Agents sidebar is a drawer, its button sits on its own line above the dossier tabs instead of beside them.
- **Why:** beside them at 375px it took a third of the row, leaving room for about two tabs; the other five were reachable only by scrolling a 229px strip. The tabs now get the whole row and scroll with their edge cue only when they must.
- **Where:** `ui/src/views/dossier-shell.css`; the layout check gained `tabs-squeezed` / `tabs-covered` for a `data-tabs-row`.
- **What:** the layout check opens a failing command's audit lines on the Usage page on the sample only. **Why:** a real home can genuinely have no failed command, so verify:ui failed for nothing to open; the sample always has failures, so it still must open some. **Where:** `states()` in `ui/scripts/layout-check.mjs`, which takes `headerFits` as its sample flag.
- **Cost of the tabs decision:** the button's own row adds about one button-height above the tabs on phones and tablets. Alternatives not taken: fold Agents into the header Menu or palette, or an icon with a count at the end of the tab row (which leaves the tabs about 295px at 375px).

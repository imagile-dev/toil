# Plain's header folds into its Menu at desktop widths (#387)

The cause was two things, and either one alone folds Plain's header at 1440 px.

- **Measurement.** React Aria's `SelectValue` shows its "Select an item"
  placeholder on its first render, before its collection is built, and
  `useCrowded` (`ui/src/App.tsx`) measures the row in that first layout effect.
  Its verdict sticks until the window gets wider, and every time the full row
  mounts again (after a fold) it measures the placeholder again. Plain is the one
  theme with two Choices in the header (Theme and Appearance), so two wide
  placeholders put its row over the edge, even at 1520 px. **Fixed in the Choice,
  not in the measure:** `Choice` (`ui/src/components/choice.tsx`) renders the chosen
  label from its own `options`, so the first render shows the real value. Waiting a
  frame before measuring would have worked too, but would show the full row and
  then fold it, a visible flip.
- **Layout.** With the real labels, Plain's dossier header still needed 1,501 px,
  because each Choice button holds a 7rem minimum. **In the header's row only**,
  the Choice buttons are now as wide as their values (`.settings .choice-button {
  min-width: 0 }`), and the row's gap between the name, the links and the controls
  is 1rem instead of 1.5rem. Plain's row now needs about 1,420 px; the other themes
  have more room than before. Elsewhere (Settings, the Command Center's filters),
  Choices keep their 7rem minimum. The button's width now follows the theme's name,
  so the controls shift a few pixels when the theme changes; they're right-aligned,
  so nothing else moves.
- **Not changed:** the crowding check itself. The Menu still appears whenever the
  row is genuinely full, for example with a long dossier name. A re-measure when web
  fonts finish loading was tried and dropped, because measuring showed fonts were
  never the cause here.
- **The regression check is in the layout check** (`ui/scripts/layout-check.mjs`):
  at 1440 px or wider, a shown Menu button in the header is a `folded` problem, for
  every theme and scheme, so Plain light and dark are both covered. Only on the
  sample data: `verify:ui`'s real-data run passes `headerFits: false`, because a
  real dossier's name and links can genuinely fill the row. Reverting
  either fix makes it fail. `ui/test/choice.test.tsx` also checks that a Choice
  shows its label in the first layout effect.

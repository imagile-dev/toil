# Crate looks like the toil site, without the pallets (#397)

- **The pallets, the racking and their parallax are gone, and so is the parallax
  machinery.** Crate was the only theme with a parallax backdrop, so `Ambient.tsx` now
  holds only the particles' canvas: no `PARALLAX` set, no layers, no
  requestAnimationFrame fallback, and `ambient.css` lost `.ambient-layer`. Keeping an
  unused hook for a theme that might want parallax one day would be code nothing runs.
  `pallets.webp` and `racking.webp` are deleted, and `theme.json` no longer lists them.
- **The backdrop is the site hero's, held still behind every view, on the body.** Crate's
  `theme.css` draws the flame glow (top right) and a faint amber glow (bottom left) on
  `body::before`, and the drafting grid on `body::after`, both fixed and at `z-index: -2`,
  under the dust's canvas. They're on the body, not the ambient layer, so they stay when
  the theme's particles are switched off, the way Starship keeps its starfield.
- **The grid drifts one cell every two minutes, as on the site, by transform.** The site
  animates `background-position`, which repaints the whole layer every frame; moving the
  pseudo-element with `translate3d` gives the same drift on the compositor. It follows the
  motion settings like every other animation (the OS setting and `data-motion`).
- **The glow is dimmer than the site's hero.** The site's hero glow peaks at 24% flame;
  text sits straight on Toil UI's page wherever the glow is, so it peaks at 14%. Worked
  out from the colours at the peak, under a grid line: muted text is 5.9:1, danger 4.8:1,
  link 7.9:1, ink 12.1:1. At 18% danger would fall to 4.45:1. The amber glow is 7%
  (danger 5.1:1). axe can't measure text over a gradient, so these figures are the check.
- **The dust is brightest in the flame glow instead of a light shaft.** The shaft was the
  warehouse's; the site has no shaft. `presets.ts` replaces `shaft()` with `flame()`, the
  same linear fall-off from the same centre and radius as the CSS gradient, and
  `motion.test.tsx` checks both against `theme.css`'s exact gradient string.
- **Panels take the site's flat surfaces.** The kraft and packing-tape gradients on the
  header, cards, stats, the Ask pane and board columns are removed, so they fall back to
  the shared `surface`/`raised` tokens and the `line` hairline, as the site's cards are.
  The dossier card's 3px accent bar on the left is gone too; the site's cards have none.
- **The header is the site's: 88% of the near-black over the page, with its hairline.**
  The site also blurs what's behind its sticky header; Toil UI's header doesn't stick, and
  `backdrop-filter` would make it the containing block for anything fixed inside it (the
  Menu), so there's no blur.
- **The eyebrow is the site's:** small mono capitals, 0.1em tracking, after a ring in the
  accent. It's CSS only, so the themed word ("Consignment", "Yard office") is unchanged in
  the DOM and for screen readers. Selection takes the site's accent too.
- **Kept as they were:** the tokens (already the site's, held by `test/brand-sync.test.ts`),
  Source Serif 4, IBM Plex Sans and Fira Code, the Fredoka wordmark and its gradient, the
  mark, the loading and lost art and the crate's bob, the dust, the accent gradient on
  buttons, the meter, big numbers and the Ask bar, and every word of the lexicon and voice.
- **Copy that named the parallax now doesn't:** the Motion settings text, its help topic,
  `ui/docs/themes.md` and the theme's description, which the picker and the site's `/ui/`
  showcase read.

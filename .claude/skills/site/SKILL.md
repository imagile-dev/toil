---
name: site
description: Rules for toil's GitHub Pages site under site/ (Astro), and for the brand it shares with the terminal welcome screen in src/welcome/. Use when changing any page, component, style, colour token, the logo or its animation, data file (integrations board, principles), generated art, when adding or updating an integration's docs page, when touching the terminal splash, menu palette or logo in src/welcome/, or when taking the desktop and 375px screenshots a site PR needs.
---

# Site

`site/` is an Astro site deployed to https://imagile-dev.github.io/toil/ by
`.github/workflows/pages.yml` (it builds on every PR that touches `site/` and deploys
from `main`).

- **Always mobile responsive.** The site is read wherever a shared link lands, and
  that is often a phone, so a page that only works on a desktop isn't finished, the
  same way *principle 8* treats platforms. Every page and component works from 320px
  up with a 16px side gutter: nothing scrolls sideways, text stays readable without
  zooming, standalone tap targets (buttons, nav and footer links, "see all" links; not
  links inside a sentence) are at least 44px tall, and multi-column layouts collapse to one
  column. Wide content (code, tables) scrolls inside its own container, never the
  page. Grid children get `min-width: 0` so one long line can't widen the layout.
- **Dark only.** It uses the Imagile design system's bones (type, grid, spacing,
  drafting-style iconography) in a dark finish with toil's own, brighter palette:
  all warm, with a flame-to-amber accent gradient and amber on its own for values,
  "live" states and small highlights, as tokens in `site/src/styles/global.css`.
  There's no second hue: no green, teal, blue or purple, in the site or in
  generated art. No light palette, no theme toggle. The background stays
  `#16130f` because the generated art is painted on it.
- **Imagile is credited prominently**: a byline in the header, a linked "By Imagile"
  in the hero eyebrow, and a feature panel in the footer, all pointing to
  https://www.imagile.dev. Imagile's mark keeps its own colours.
- **Honest about status** (*principle 4*). Until a version is on npm, the site says
  pre-release and labels sample output as planned. An integration is `planned`
  until its code is on `main`, then shows its verification level. Statuses on
  `/integrations/` use the same levels as **Verification Levels** (`integrations`
  skill), plus `planned`.
- **A shipped integration's docs page lists its real commands and settings** from
  `site/src/data/commands/<area>.json` and `site/src/data/settings/<area>.json`
  (every connection key, its env var and any CI fallback), which
  `test/site-commands.test.ts` writes from the registry, one file per area. Never
  edit them by hand; run `npx vitest run -u` in the root. A page whose area has no
  write command leaves out the Writes section.
- **One source per fact.** Each integration's board entry is its own file,
  `site/src/data/integrations/<area>.json` (status, credential, supported version);
  `site/src/data/integrations.ts` gathers them and `docs/integrations.md` points at
  them; `site/src/data/principles.ts` restates the **Principles** in CLAUDE.md for
  users and keeps their numbering.
- **Motion everywhere, never required.** Every animation sits behind
  `prefers-reduced-motion: no-preference`, and scroll reveals only hide content after
  `motion.js` has armed them, so with no JS or reduced motion everything is visible.
  A reveal never clips the observed element itself (a fully clipped element never
  intersects, and a lazy image inside it never loads); clip its children.
- **House style has three registers; pick by job, never mix them in one image.**
  - *The mark* is toil's logo, and the central integrator drawn literally. A
    terminal (a sheet with a `>_` prompt) is the hub. Three branches leave each
    side of it and fan out to six tools, dots on an outer ring at 0° and 38° either
    side of horizontal. It's flat, symbolic, serious, and hand-built SVG: the
    component is `site/src/components/Logo.astro`, the static copies are
    `public/favicon.svg` and `public/brand/toil-avatar.svg` (circular, with
    transparent corners, exported to 512 and 256 PNG for avatars). All three share
    one geometry; change them together. It never comes from an image model, and
    has no characters and no jokes.
  - *The terminal draws the same mark.* Bare `toil` opens a splash
    (`src/welcome/logo.ts`) that draws this geometry on a braille canvas, and the
    menu (`src/welcome/term.ts`, `PALETTE`) uses the site's colour tokens. **The
    site and the terminal are one brand: a change to the mark's geometry or to a
    colour token changes both in the same PR.** `test/brand-sync.test.ts` reads
    `global.css` and `Logo.astro` and fails when the terminal's palette, ring,
    branches or tools differ from the site's. It can't see the motion, so a change
    to the "Command" motion is mirrored by hand (the terminal plays it twice, then
    spins the ring twice).
  - *Its motion is "Command".* The ring and branches draw in, and the tools pop
    on. Then, every 4.5s, the cursor types two keystrokes, a signal fires down all
    six branches at once, and each tool bumps as it arrives. The motion is pure
    CSS, so reduced motion turns it off.
  - *Diagrams* are precise drafting-style line drawings for how-it-works art (the
    hero), generated with `.claude/image-generation/style.md`.
  - *Cartoons* are lighthearted spot illustrations, generated with
    `.claude/image-generation/style-cartoon.md` (pass `--style-file`). The recurring
    character is the crate, a package box in an amber-striped hard hat. The crate is
    always competent; the joke is on the bureaucracy around it, never on users or
    their employers.
- **Generated art** sits on the page colour `#16130f` (or darker) and shows with
  `mix-blend-mode: lighten` on its wrapper, so the grid shows through. Ship WebP at
  960 and 1536 wide; the PNG masters stay in the ignored run folders. Every cartoon
  gets real alt text describing the joke.
- **Documentation has two levels:**
  - **How it works** (`/how-it-works/`) is the high-level picture: the one-core
    design, output, configuration, credentials, safety, MCP and installation. It
    changes only when the big picture does.
  - **The docs** (`/docs/`) are the detail: getting started, and one page per
    integration at `/docs/integrations/<area>/`, generated from
    `site/src/data/integrations.ts` by `src/pages/docs/integrations/[area].astro`.
    An integration on the board therefore always has a page, and each board tile
    links to its page.
- **Every new or changed integration reviews its docs page in the same PR**:
  setup, credential and where to create it, config keys, commands, verification
  level. Add a `credentialWhere` entry only when the menu path is certain; a wrong
  path costs users more than a generic one. Pages for `planned` integrations say so
  and describe the plan, never invented details.
- **Every new or changed `util` command updates `/docs/utilities/` and
  `skills/toil/util.md` in the same PR.** The page is generated: each family of
  commands has its own file, `site/src/data/utilities/<family>.json` (`commands`,
  the paths under `toil util` it covers; `purpose`, `inputs`, `examples`,
  `verifies`, `limits`; `group` and `order`), in one of the four groups in
  `site/src/data/utility-groups.json` (reading CI output, writing for the tools,
  safety, arithmetic models get wrong). Backticks in the prose become code. Flags,
  aliases and MCP tool names come from `data/commands/util.json`, never by hand, so
  don't write them in the template. `test/util-docs.test.ts` fails on a command
  with no entry or no example, an entry for a command that doesn't exist, an example
  or `--flag` the command doesn't have, a missing row in util.md's command table,
  and unbalanced tags in `utilities.astro`.
- Internal links go through `url()` in `site/src/lib/url.ts` because the site is
  served under `/toil/`.
- **Phones get a menu.** The header shows its links inline on desktop, drops the
  least-used one below 900px (it stays in the footer), and folds the rest into a
  `<details>` menu below 720px, which works without JavaScript.
- Any change under `site/src/` is checked in a browser at desktop width, 375px and
  320px before the PR opens (`document.documentElement.scrollWidth` must equal the
  viewport width), with desktop and 375px screenshots in the PR. `main` clips
  horizontal overflow, so decorative art can bleed but never widen the page.
- **The dev server sometimes serves stale scoped CSS** after a component's styles
  change. If a rule you just wrote doesn't apply, check the built CSS
  (`npm --prefix site run build`, then look in `site/dist/_astro/*.css`) and restart
  the dev server before debugging specificity.

```bash
npm --prefix site ci
npm --prefix site run dev     # http://localhost:4321/toil/
npm --prefix site run build
```

### Screenshots for the PR

The browser pane's viewport emulation can paint only part of a tall page. For proof
images, run `node scripts/shoot.mjs <page>...` against the dev server (or `--base`
another): headless Chrome with a throwaway profile, full-height shots at desktop
width and 375px set through the DevTools protocol (so no iframe is needed for
Windows' minimum window width), and a sideways-scroll check at 375px and 320px that
fails the run. Host the
images on the orphan `screenshots` branch under `pr-<n>/` and link them by
`raw.githubusercontent.com` URL. That branch is never merged.

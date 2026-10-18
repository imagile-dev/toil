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
  pre-release and labels sample output as planned. An integration is on the board
  only once its code is on `main`, and shows its verification level: `unit`,
  `live` or `stable` (**Verification Levels**, `integrations` skill). Their
  meanings are rendered from `site/src/data/levels.json`, never written out in a
  page.
- **The docs are the toil skill, rendered.** `skills/toil/*.md` is the one copy of
  the reference: every page under `site/src/pages/docs/` but `/docs/welcome/` renders
  one of its files through `src/components/SkillPage.astro`, the file's own heading
  and description become the hero, and inline `<file>.md` references become links
  (`src/lib/skill-pages.mjs`, a remark plugin in `astro.config.mjs`). A page adds
  only facts and generated lists: the board entry's status and credential, and
  "at a glance" lists of commands and settings from `site/src/data/commands/<area>.json`
  and `site/src/data/settings/<area>.json`, which `test/site-commands.test.ts` writes
  from the registry (run `npx vitest run -u` in the root; never edit them by hand).
  `test/site-docs.test.ts` fails on a page with a run of literal text longer than a
  label, so reference prose goes in the skill file, never in a template.
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
  - **The docs** (`/docs/`) are the detail: `SKILL.md` as the index, `core.md`,
    `install.md`, `mcp.md`, `db.md`, `util.md`, `skills.md`, and one page per area
    file at `/docs/integrations/<area>/`, generated by
    `src/pages/docs/integrations/[area].astro` from the files themselves. A new
    area's file is its page with no page code, and the test fails when a board
    entry has no file, so each board tile links to a page.
- **Every new or changed integration reviews its skill file, which is its docs
  page, in the same PR**: setup, credential and where to create it, config keys,
  commands, verification level. Add a `credentialWhere` entry only when the menu path is certain; a wrong
  path costs users more than a generic one. Never invent a detail the area's
  registry or board file doesn't hold.
- **`/docs/utilities/` is `skills/toil/util.md`**, rendered, with each command's flags, aliases and MCP tool from the registry; the rule that a `util` change updates it is in `docs/util.md`.
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

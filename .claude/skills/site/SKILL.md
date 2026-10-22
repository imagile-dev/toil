---
name: site
description: Rules for toil's GitHub Pages site under site/ (Astro), and for the brand it shares with the terminal welcome screen in src/welcome/ and Toil UI's header. Use when changing any page, component, style, colour token, the logo or its animation, the wordmark or its font, data file (integrations board, principles), generated art, when adding or updating an integration's docs page, when touching the terminal splash, menu palette or logo in src/welcome/, or when taking the desktop and 375px screenshots a site PR needs.
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
- **Honest about status** (*principle 4*). Until 1.0, the site says **Alpha**
  ("Alpha: APIs and flags may change before 1.0", the README's wording) by the
  install commands and in the hero, and labels sample output as planned. The
  homepage's two ways to start come from `site/src/data/start.json`, copied from the
  README; `test/start-commands.test.ts` fails when they drift. An integration is on the board
  only once its code is on `main`, and shows its verification level: `unit`,
  `live` or `stable` (**Verification Levels**, `integrations` skill). Their
  meanings are rendered from `site/src/data/levels.json`, never written out in a
  page.
- **The docs are the toil skill, rendered.** `skills/toil/*.md` is the one copy of
  the reference: every page under `site/src/pages/docs/` but `/docs/welcome/`, `/docs/ui/`
  (`ui/README.md`), `/docs/themes/` (`ui/docs/themes.md`) and `/docs/ui-help/`
  (`ui/docs/help.md`) renders
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
  - *The mark* is toil's logo: the badge. A flame-to-amber tile (the 45° gradient,
    flame at the bottom-left, amber at the cut corner) whose top-right corner is
    cut on the diagonal, parallel to the fold of the page it holds, and on the page
    a `>_` prompt: a near-black chevron and a deep-flame cursor (`#c43d12`, 4.6:1
    on the page). The cut corner is what makes it toil's: the `>_` alone is
    everyone's (macOS Terminal, Windows Terminal, Lucide's square-terminal), and a
    cursor on a warm gradient tile is close to JetBrains', so the page stays a light
    sheet with a dark fold, never a dark square. It's flat, symbolic, serious, and
    hand-built SVG: the component is `site/src/components/Logo.astro`, the static
    copies are `public/favicon.svg` and `public/brand/toil-avatar.svg` (the badge on
    a near-black disc, circular with transparent corners, exported to 512 and 256
    PNG; Discord's posts use the 512, see the `automation` skill). All of them share
    one geometry; change them together. It never comes from an image model, and has
    no characters and no jokes. **Never add a spark, starburst or sparkle to it**, in
    any theme or any size: an orange agent CLI with a burst is another product's
    mark. Sizes: 34px in the header, 26px in the footer, 192px at most in the
    homepage's closing call to action.
  - *Its motion is a cursor blink.* The cursor blinks three times on load and again
    when the pointer or focus reaches the link around it, then stays lit, so it
    never blinks for five seconds (WCAG 2.2.2). It's pure CSS, behind
    `prefers-reduced-motion: no-preference`.
  - *The terminal draws the badge in orbit.* Bare `toil` opens a splash
    (`src/welcome/logo.ts`) that draws the badge, shrunk, on a braille canvas with
    six tool dots (amber, flame, cream, repeating) on an implied ring around it: the
    badge fades in, the dots pop on, the cursor blinks twice, the ring turns half a
    revolution and settles on the picture it left. Its still copy is
    `public/brand/toil-orbit.svg`, for docs. The menu (`src/welcome/term.ts`,
    `PALETTE`) uses the site's colour tokens. **The site, the terminal and Toil UI
    are one brand: a change to the badge's geometry or to a colour token changes all
    three in the same PR.** `test/brand-sync.test.ts` fails when the terminal's
    palette, tile, page placement or orbit, or any static copy, differs from the
    site's. It can't see the motion, so a change to it is mirrored by hand.
  - *Toil UI wears the badge in every theme.* A theme that brings none (one from
    the user's folder) shows the standard badge (`ui/src/mark.svg`). Plain's is the
    same badge in Plain's own blue, one per scheme (the tile takes that scheme's
    `accent`, with a white or dark page; `assets/mark-light.svg` and
    `mark-dark.svg`), so the quiet theme never wears flame. Each built-in game theme
    has its own skin of the same silhouette in `ui/themes/<theme>/assets/mark.svg`: Crate
    kraft cardboard with a hazard-striped tape and a stencilled prompt, Harvest a
    16-pixel wooden sign, Starship a riveted hull plate with a glowing console, Realm
    an illuminated tile with a gilt edge, Frontier a riveted brass boiler plate
    with a copper rule, Overworld a mossy dungeon block with a torch-gold rim. It sits beside the name at 32px (twice
    Harvest's grid), and it is the tab's icon too (`ui/src/favicon.ts` swaps it with
    the theme). A new theme's mark keeps the tile's silhouette and a prompt at 4.5:1
    on what it sits on; the test holds the tile's path in every skin.
  - *The wordmark* is the word "toil" in Fredoka 600 (`--font-brand`, the class
    `.wordmark`): the site's header and footer, and Toil UI's header in every theme,
    where "UI" is a die-cut sticker stuck on beside it, so the word itself never
    changes. It's real type, never an image, and only the word "toil" uses it;
    headings and the hero keep their faces. Only the Latin 600 file is imported.
    The terminal draws the same word from the face itself: `scripts/gen-wordmark.mjs`
    rasterises Fredoka 600 in headless Chrome onto quadrant blocks (two pixels across
    and two down per cell, sampled twice as densely across because a cell is twice
    as tall as it is wide) and writes `src/welcome/wordmark.ts`; hand-tuning goes in
    the script's `TUNE`, never in the data. It's 8 lines by 33 columns, shaded flame
    at the baseline to amber at the top, over a one-cell shadow in a dark flame
    (colour only), with a cursor after it that blinks with the badge's. The splash
    and the menu draw it at that one size, never stretched for a wide window, so it
    sits beside the logo at 80 columns. A change to the face
    changes all three in the same PR; `test/brand-sync.test.ts` holds the site's and
    the UI's token, weight and version together. Both favicons are the badge.
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
    `dossiers.md`, `install.md`, `mcp.md`, `db.md`, `util.md`, `skills.md`, and one page per area
    file at `/docs/integrations/<area>/`, generated by
    `src/pages/docs/integrations/[area].astro` from the files themselves. A new
    area's file is its page with no page code, and the test fails when a board
    entry has no file, so each board tile links to a page.
  - **Diagrams in the docs** are hand-drawn HTML and inline SVG in
    `site/src/figures/<name>.html`, never a runtime library or CDN. A skill file
    places one with a `<!-- figure: <name> -->` line, which agents read past and the
    remark plugin in `src/lib/skill-pages.mjs` swaps for the figure (`{base}` in it
    becomes the site's base path). The prose around it says the same thing in
    words. Each is a `<figure>` with a caption, an SVG has a `<title>` and `<desc>`,
    a drawing too wide for a phone has a second, tall variant, and scrolling code
    is `tabindex="0"` with a label; `test/site-docs.test.ts` checks all of it. The
    figures' styles live in the page that renders the file
    (`src/pages/docs/dossiers.astro`). Toil UI's own docs, `ui/docs/*.md`
    (`/docs/themes/`, `/docs/ui-help/`), place figures the same way, and `UI_DOC_PAGES` in
    `skill-pages.mjs` names each one's page.
- **Toil UI's help links land on real headings.** Every Read more link in Toil UI is a
  page and heading id in `ui/src/help.ts`; `npm run build` ends with
  `scripts/check-help-links.mjs`, which fails when one isn't in the built pages, so a
  renamed heading in a docs page that Toil UI links to updates its topic in the same PR. The dev server keeps a figure's old
    markup until it restarts.
- **Every new or changed integration reviews its skill file, which is its docs
  page, in the same PR**: setup, credential and where to create it, config keys,
  commands, verification level. Add a `credentialWhere` entry only when the menu path is certain; a wrong
  path costs users more than a generic one. Never invent a detail the area's
  registry or board file doesn't hold.
- **`/docs/utilities/` is `skills/toil/util.md`**, rendered, with each command's flags, aliases and MCP tool from the registry; the rule that a `util` change updates it is in `docs/util.md`.
- **`/ui/` is Toil UI's showcase** (#374), in the nav and on the homepage: the real
  `ui/` app in a frame, running on its fixture `execute()` and scripted Agent, with a
  theme picker, a tour of its views, and what a theme changes about the agent (the
  prompt, the answer, the wording). Everything it says about prompts and wording is
  read from Toil UI's source at build time (`ui/scripts/showcase.ts`, which `ui/test/showcase.test.tsx` checks), never written
  out again; a source that changes shape fails the build. The app itself is static
  files at `/ui/app/`, labelled "Toil UI alpha, on sample data" on every view. `npm run
  dev` and `npm run build` build it first (`scripts/ui-preview.mjs`, into
  `ui/dist/preview/`, copied to `public/ui/app/`), so run `npm ci --ignore-scripts` at
  the repository root once (`ui/` is its workspace). `/ui-preview/`, its old address,
  forwards to `/ui/` with its query and hash, and `/ui/?theme=<name>#<route>` opens
  that theme and route in the frame (`ui/?theme=crate#/dossier/settlement`). The app's
  views are hash routes: the dossier list at `#/` and a dashboard at `#/dossier/<name>`;
  `ui/app/?theme=crate#/dossier/settlement` is the app alone, which `scripts/shoot.mjs`
  can shoot. `/docs/ui/` renders `ui/README.md`, the package's own reference.
- Internal links go through `url()` in `site/src/lib/url.ts` because the site is
  served under `/toil/`.
- **Phones get a menu.** The header shows its links inline on desktop, drops the
  least-used one below 900px (it stays in the footer), and folds the rest into a
  `<details>` menu below 800px, which works without JavaScript.
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

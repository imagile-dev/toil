# Site search and start-here paths (#433)

- **No search library: a small pure-JS index and ranker of our own**
  (`site/src/lib/search.mjs`), not Pagefind or a static-search package. Pagefind's
  npm package installs a platform binary, and the rest bring a dependency to pin and
  age-check for what is about 150 lines here. It adds no dependency at all, so there
  is nothing to pin. The index is headings and short descriptions, not page bodies:
  about 1,300 records and 235 KB (much less gzipped, as Pages serves it), loaded the
  first time search opens, never on page load.
- **The index is built from the built pages, after `astro build`**
  (`site/scripts/search-index.mjs`), not from an Astro endpoint. Reading the HTML is
  the only way to get every page's headings, `.astro` pages included (How it works,
  the principles, the welcome menu), with nothing listed by hand. Commands, settings
  and env vars, integrations and engines come from the registry's data files in
  `site/src/data/`, so each is a result with its own name rather than a heading. The
  cost: `npm run dev` has no index, and the dialog says so; search runs on
  `npm run build` and `npm run preview`.
- **Every result is checked to land.** `check-links.mjs` reads `dist/search.json`
  and fails on a result whose page or id the build didn't make, and the index script
  fails when a kind of record comes out empty, so search can't quietly lose commands.
- **A heading without an id links to the `<section>` it's in**, else to the page.
  A command links to its area page's Commands at a glance (or the command index when
  no page documents its group), and a setting to Settings at a glance, the same
  targets the command index already used (`commandGroupPage` in `skill-pages.mjs`,
  moved there from `docs/commands.astro` so both share it).
- **Ranking is plain and explainable:** every query word must match; a word counts
  most in the title, then extra keywords (MCP tool name, aliases, a setting's key
  and CI fallback, an integration's area and credential), the page, then the
  description, doubled at the start of a word; a title, or an integration's area,
  equal to the query ranks first. Thirty results at most.
- **Results are plain links, not a listbox.** Arrow keys move focus between them,
  Enter in the box opens the first, Esc closes and returns focus to the button; a
  polite status line announces the count. Links keep middle-click, copy link and
  screen-reader link behaviour, and avoid axe's nested-interactive rule.
- **The Search button is hidden until the script runs**, since without JavaScript
  there is nothing to search with; every page is still linked from the header and
  footer. It sits between the nav links and GitHub, a box with `/` from 1000px and
  an icon below that.
- **The start-here paths sit in Get started, above the two installs**, so the
  homepage keeps five sections (principle 11). The section's heading became "Start
  where you are."; the install cards' line, with the Node requirement and the Alpha
  badge, moved just above them. The roles are "You work with an agent", "You lead a
  team" and "You run CI/CD", with the issue's three steps each. Analyze has no
  heading of its own, so that step links to The agent in Toil UI's docs, where the
  Ask bar and Analyze are described. The paths are data in `docs-path.ts`, and a
  test holds every step to a page on the docs path.
- **Search and the start-here paths use the site's colour tokens only**
  (`var(--color-…)`, and `color-mix` over them for the backdrop and the step
  numbers' ring), never a hex or `--rgb-*` value, so the site-wide reskin (#442)
  carries them over unchanged.

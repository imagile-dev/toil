# The theme-moments measure and contact sheets as repo tools (#464)

- **Two scripts and a shared kit, beside the layout check.** `ui/scripts/moments-measure.mjs`
  (`npm run moments:measure -w ui`) and `ui/scripts/screens-sheet.mjs` (`npm run screens:sheet
  -w ui`) share `ui/scripts/moments-kit.mjs`: the themes with moments (read from each
  `theme.json`, so a new theme is covered with no edit), the build, the sample server in a
  throwaway home with no `TOIL_*` variable, the CPU reading, and the frame arithmetic. The
  arithmetic is pure and tested (`ui/test/moments-kit.test.ts`, with a `.d.mts` as the ADO seed
  scripts have); the browser runs aren't, since they are the thing that can't run in CI.
- **One Chrome helper, extended rather than copied.** `ui/scripts/chrome.mjs`'s `openBrowser`
  takes `{ gpu }` and returns `newPage()` and the browser-wide `cdp` (for `Tracing`); a page
  gains `send`, `on` and `close`. The layout check and `verify:ui` call it as before and still
  render in software. The measure turns GPU compositing on, as #451 measured; `--no-gpu` is there
  for a machine whose headless GPU draws no frames.
- **#451's method, as it was run, is the default.** 1440x900, Theme motion full, three runs, each
  theme in a fresh profile with a cold pass then a warm pass, the splash over a dossier opening
  with every API call slowed by 250 ms, the loader preview for 3 s, the recap from showing to
  gone, a rAF recorder for frame times and `PipelineReporter` for dropped frames. The cold pass is
  how the shader cache is warmed (a page can't warm it without drawing the same things, #451), so
  it always runs; `--cold` only adds its column. `--throttle`, `--motion subtle` and `--runs`
  cover the other runs #451 made.
- **Exit 1 on a warm frame over 20 ms or a phase that didn't play**, never on a dropped frame:
  #451's own table has single dropped frames on a quiet machine, so a dropped frame is reported,
  not failed. `--report-only` always exits 0.
- **The tool reads the machine's load itself.** It samples CPU time for two seconds before it
  starts, warns above 15% busy, and prints both that and the share during the run (its own
  Chrome included) above the table, so a table always says what it was measured on. The
  threshold is a judgement: a quiet desktop reads a few percent.
- **Contact sheets are built in Chrome, not an image library.** Each sheet is an HTML page of its
  frames, screenshotted by the same headless Chrome, so the tool adds no dependency and no Python.
  The frames and the HTML stay beside the PNG, so one frame can be looked at full size.
- **Every frame is a still.** A hook installed before the app's script catches each animation
  the engine starts (`Element.animate`) on a moment, the dossier or its tab, paused at its first
  frame, and every animation on the page is set to the same instant for each shot. An event
  moment's hold runs in real time; its leave is caught paused when it starts, and stepped. A
  moment's card is cropped to its layout box (offsets, which ignore the arrival's transform):
  stepping an arrival to its end to measure it, then back to its start, left Chrome showing its
  end on every frame after.
- **The sheets' defaults are 375 and 1440px**, as the coordinating session asked; the issue named
  768 too, which `--width 768` adds. Theme motion full, subtle and off by default, off showing
  what doesn't play as a note on its row.
- **Output goes to `ui/.moments/`**, ignored by git like `ui/.verify/`, and neither tool is part
  of `verify:ui` or CI. `ui/README.md`, Measuring theme moments, says how and when; the theme
  moments section of `ui/docs/themes.md` and the PR template's checklist point theme PRs at it.

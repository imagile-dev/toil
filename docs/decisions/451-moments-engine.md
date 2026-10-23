# The moments engine: one animation to an element, and a quiet-machine re-measure (#451)

- **A looping picture gets a holder, in the engine.** `Art` (`ui/src/moments/Moments.tsx`) now
  renders a picture that has a loop as a `span.m-hold` carrying the part's class
  (`.splash__art`, `.loader__art`) with the `img` inside carrying the loop. The engine's arrival
  (`enter()`) plays on the holder, so no element carries both, the way a sprite sheet's strip
  already sat inside its frame box. Every picture with a loop is wrapped, not only the splash:
  the loader has no arrival today, but the rule "a loop goes on the inner element" holds
  wherever one is added later, and theme CSS that framed `.loader__art` (Crate's blend,
  Realm's tray margins) applies to the holder unchanged; Realm's die still lands at the tray's
  centre to the pixel. A picture with no loop stays one `img`, as before. Crate's splash, the one
  that paired `rise` with `bob`, is fixed with no edit to the theme: its trace had two
  animations Chrome couldn't composite (reason 64, incompatible animations) and now has none.
- **The check is a test that plays every arrival.** `ui/test/one-animation.test.tsx` renders,
  in every theme with moments, the splash, every event moment in turn, the dossier entrance and
  a tab change, records each element the engine animates (a stand-in for `element.animate`,
  which jsdom lacks), and fails if that element carries an `m-loop--*` class or matches any rule
  in the app's stylesheets or the theme's that starts an animation (inside `@media` too, as if
  motion were allowed; pseudo-elements are left out, being boxes of their own). It also renders
  the splash and a loading screen and fails if any looping part (a loop, a sprite sheet's strip,
  a progress track's piece) is matched by more than its one rule. Put back the old `Art` and it
  fails on Crate's splash; add a theme rule animating the loader's picture and it fails there. A test rather than a lint rule, because what lands on an
  element is only known once the engine has rendered it; a dev-time warning was left out, since
  the test already covers every theme on every run.
- **Sprawl's panel scan-in moves by opacity and transform.** `.l-card` came up through an
  animated `clip-path` (#412), which Chrome plays on the main thread. Now the card's face comes
  up in the same four steps by `opacity`, while a cyan scan line, the card's `::after` scaled
  from its top edge by `transform`, runs down it in the same four, so it still reads as a signal
  scanning in. Kept at every Theme motion level but off, as before. A test holds both keyframes
  to `transform` and `opacity`.
- **The splash's slow frames at about 190 and 730 ms didn't reproduce on a quiet machine**, so
  the engine's handover is unchanged. Measured with nothing else running, in headless Chrome at
  1440px, with every API call slowed by 250 ms so the splash plays over a dossier opening and
  hands over to it: no frame over 20 ms in any theme, at the first data or at the handover, with
  GPU compositing or without, before this change or after. With the CPU throttled four times,
  the handover still stayed under 20 ms in every theme. The frames #438 saw are what the shared
  machine's load did to it, not work the engine does; mounting the page hidden or fading the
  splash out would add a wait and a second animation for nothing measurable, so neither was
  done.
- **The first-open stall is Chrome compiling GPU shaders, and only on a fresh profile.** The
  90 to 220 ms stall the theme PRs saw the first time something opened is one task on Chrome's
  GPU thread, made of Skia `shader_compile` cache misses (`FillRRectOp` programs for the theme's
  rounded, gradient panels). It is not an image decode and not the main thread: Starship's
  stall stayed with its splash picture, its frame, its shadows, its page background and the
  splash itself hidden. Chrome keeps compiled shaders in the profile's disk cache, so a person
  sees it at most once per browser version; in the same browser, a second launch has none. The
  measurement now runs each theme twice in one fresh browser, reports the second pass as the
  figure, and gives the first pass's worst frame beside it. A page can't warm Chrome's shader
  cache without drawing the same things, so nothing was added.
- **How it was measured** (a scratch script, not committed, as each theme PR's was): the built
  `toil-ui --sample`, headless Chrome 155 with GPU compositing on Windows 11, 1440×900, motion
  allowed and Theme motion full, three runs of every theme, each in its own fresh profile with a
  cold pass then a warm pass. A `requestAnimationFrame` recorder runs throughout, as #437 set out,
  because Sprawl's rain and Realm's embers draw at 30 fps by design and raw presented-frame gaps
  read as 33 ms frames there; Chrome's frame reporter (`PipelineReporter`) gives the dropped
  frames, and its `Animation` events the ones not composited. Phases: the launch splash from
  showing to 500 ms after it hands over, the loading screen preview for 3 s, and the sprint recap
  from showing to gone. Headless Chrome's GPU frame here is 18.1 ms, so the medians sit there
  and every theme's worst is within its jitter.
- **The bar is met everywhere; nothing is left over.** Each cell is the median frame / the worst
  frame / frames over 20 ms / frames Chrome dropped, over three warm passes, with this change:

  | Theme | Splash | Loader | Recap | First launch, cold shader cache: worst (splash, loader, recap) |
  |---|---|---|---|---|
  | Crate | 18.1 / 19.4 / 0 of 329 / 0 of 382 | 18.1 / 19.5 / 0 of 503 / 0 of 502 | 18.2 / 19.7 / 0 of 939 / 0 of 930 | 19.7, 19.3, 19.5 ms |
  | Harvest | 18.1 / 19.4 / 0 of 331 / 0 of 385 | 18.1 / 19.3 / 0 of 501 / 1 of 501 | 18.1 / 19.4 / 0 of 941 / 0 of 936 | 19.4, 19.4, 19.8 ms |
  | Starship | 18.3 / 19.6 / 0 of 328 / 0 of 380 | 18.1 / 19.4 / 0 of 501 / 0 of 501 | 18.2 / 19.5 / 0 of 941 / 0 of 933 | 235.1, 19.6, 19.5 ms |
  | Sprawl | 18.1 / 19.5 / 0 of 330 / 0 of 388 | 18.2 / 19.4 / 0 of 501 / 0 of 502 | 18.1 / 19.2 / 0 of 939 / 0 of 933 | 19.3, 19.3, 19.7 ms |
  | Frontier | 18.2 / 19.5 / 0 of 327 / 0 of 382 | 18.1 / 19.5 / 0 of 502 / 1 of 507 | 18.1 / 19.7 / 0 of 943 / 0 of 940 | 147.6, 19.5, 19.3 ms |
  | Overworld | 18.1 / 19.4 / 0 of 330 / 0 of 385 | 18.1 / 19.7 / 0 of 502 / 0 of 502 | 18.2 / 19.2 / 0 of 940 / 0 of 936 | 19.3, 19.5, 19.6 ms |
  | Realm | 18.1 / 19.6 / 0 of 328 / 0 of 387 | 18.1 / 19.4 / 0 of 503 / 0 of 507 | 18.1 / 19.5 / 0 of 942 / 0 of 937 | 36.9, 19.5, 19.6 ms |

  Before it, the same run gave figures within the same jitter (worst 20.5 ms, one frame), except that Crate's splash had its two
  animations off the compositor (four across two runs). Without GPU compositing
  (`--disable-gpu`, as the layout check runs Chrome) every theme's every phase was 16.7 ms
  median and 16.8 ms worst, cold or warm. The first-launch column is the shader cache above.
- **With the CPU throttled four times**, a stand-in for a slower laptop, the splash and its
  handover stayed under 20 ms in every theme but two single frames as the splash first drew
  (Crate 36.6 ms, Realm 37.2 ms), and every theme's loader and recap preview had two slow frames
  of 35 to 73 ms as it opened. Those two are the preview menu opening and closing, not a moment:
  Plain, which has no moments, shows the same two (55.1 and 35.5 ms) on the same run. A moment
  played by a sync has no menu. Recorded, not fixed; the bar is for the unthrottled machine.
- **Splash data is a follow-up, not part of this change.** The engine change touches how art is
  wrapped, not what a splash is handed, and the splash plays before any dossier or sprint has
  loaded, so a sprint's day isn't known while it plays. Handing it data needs the engine to wait
  for or cache the sprint, which is its own design: #462.

# The header byline without Imagile's mark (#473)

- **"Imagile" stays visible from 380px to 640px.** Before, below 640px both of the
  byline's words were hidden and the 20px mark was all the link showed. With the mark
  gone that would leave an empty, focusable link, so at those widths only "by" is
  hidden and the name shows as text. Below 380px the byline still hides, as before.
  Applies to `site/src/components/SiteHeader.astro`.
- **The header's mark hover motion is gone with it.** The tilt on hover and focus
  was the only header CSS that targeted `.imagile-mark`; the link keeps its colour
  change and the site's `:focus-visible` outline. `ImagileMark.astro` and
  `site/public/images/imagile-mark.svg` stay, since the footer panel uses them.

---
description: How Toil UI explains itself and points to its settings, the (i) with its Read more link and the pencil beside a configurable value, and the rule every view follows.
lead: Explanations on request, and a way to where each thing is set.
---

# Help and edit links

Toil UI keeps each page to what you need to act. What a term means, and where a value comes from, is one press away instead of a paragraph on the page, and anything you can configure has a link to where it's set.

## The (i) and Read more

An **(i)** sits beside a term or at the end of a view's first line. Hovering or focusing it shows one or two sentences in a tooltip. Pressing it, with a click, a tap, Enter or Space, opens the same sentences in a small popover with a **Read more** link to the section of these docs that says the rest. The link is in the popover rather than the tooltip because a tooltip closes as soon as focus or the pointer leaves the (i), so a link inside one could never be reached by keyboard or touch. Escape closes either.

**Help** in the header opens the docs section for the view you're on. Read more and Help are the only links out of the app: they open this site in a new tab, and nothing is sent anywhere until you follow one.

## Edit links

A **pencil** beside a configurable value opens the settings page where it's set, at that value:

| Beside | Opens |
|---|---|
| A connection's name, such as an item's source | Settings, Connections, at that connection |
| A dossier's sources, on its card and in its top row | Settings, Dossiers, at the form that links an area, for that dossier |
| The work-in-progress limit and the people, in the People view | Settings, Dossiers, at that form |
| The fields, on an item's page | Settings, Dossiers, at the form that names a field |
| The adapter, on an assignment's page | Settings, Agent |
| A cap notice under an answer, and an assignment's limits | Settings, Agent usage, at the caps |

The pencil only navigates: it never changes anything, and the page it opens makes every change through its own form. Its name says what it edits ("Edit the corp-jira connection"), and it's the same size and in the same place in every theme. When the value it names is gone, a connection since removed say, the page says so.

## The rule for new views

- **A configurable value gets an edit link where it's shown**, to the exact settings section that sets it, through the helpers in `ui/src/format.ts` (`connectionEditHref`, `dossierEditHref`, `AGENT_SETTINGS_HREF`, `CAPS_HREF`) and the `EditLink` component. A new kind of setting adds its helper there, and its page lands on it with `useLandOn`.
- **A view keeps only its first line of explanation on the page.** The rest goes in a help topic, shown with `Help`. Text a person needs to act stays: what a form will do before it runs, a warning, an error and its fix.
- **A help topic is defined once**, in `ui/src/help.ts`: a title, one or two sentences, and the docs page and heading it links to. `ui/test/help.test.tsx` resolves every link to a heading in the docs, and the site's build checks each against the pages it built, so renaming a heading means updating its topic in the same change.

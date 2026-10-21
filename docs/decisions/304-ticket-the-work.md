# Ticket the work before starting it (#304)

- **"No likely ticket" is a warning, `OWI_SIMILAR_NO_MATCH`, on `util owi similar
  --query`**, not a new `data` field: `matches` is already empty, and the warning is
  where an agent reads what to do next (suggest a new ticket, don't lower the
  threshold). Additive, so no contract change. Pairs and item mode don't get it.
- **The skill rule lives in `core.md`, Ticket the work**, with a three-line pointer in
  `SKILL.md` (which a test caps at 4 KB) and each tracker page's own search. The
  search for "mine and not done" is each tracker's: JQL `assignee = currentUser()`,
  WIQL `@Me` then `work-item get-many`, GitHub search `assignee:@me`. toil composes;
  no command asks several trackers at once (principle 3).
- **What counts as work in the chat** is decided by plain rules, not a model: a
  prompt that isn't a question (no trailing `?`, and not opening with a wh-word:
  what, why, how, who, when, where, which; "Can you", "Show" and "Do" open polite
  requests for work too, so they count as work, and a stray banner costs a press of
  Not now), isn't a starter, and names no item by OWI id or
  key. Only the first such prompt in a chat gets the banner, so it asks once. Matching
  is against the dossier's open (not done) items: Toil UI has no notion of "the
  current user" to filter by assignee, so the banner ranks every open item.
- **"Ticket this" offers a sub-task under each match and one new ticket**, as
  proposals with toil's own create commands: Jira `Sub-task` (Jira Cloud `Subtask`)
  with `--parent` and the parent's project; Azure DevOps Server a `Task` with
  `--parent`; Azure DevOps Services a `Task` with no parent (its create takes none,
  the note says to link it on the board); GitHub a new issue whose body names its
  parent (toil has no sub-issue command). A new Azure DevOps item takes the type most
  of that area's open items have, else `Task`, and says which. Attaching to a match
  is not a proposal: it writes nothing.
- **The banner is its own component (`ui/src/components/ticket.tsx`)**, one line in
  `ask.tsx`, so the chat rework (#343, #344) can move it without untangling it.
- **Assignments need no banner today.** #304 asks for the same check on an
  assignment started from a free-form prompt; #293 (#341) shipped assignments only
  from a work item, so every assignment is ticketed by construction and its branch is
  already `agent/<key>`. When a free-form assignment exists, it should call
  `unticketed()` before it queues.
- **Proposal command lines now spell renamed flags and switches the way the CLI
  reads them**: `issueType` is `--type` on Jira's issue create, and a `true` switch
  is the bare flag (`--markdown`, not `--markdown 'true'`, which the worklog's
  Confluence proposal printed before). `ui/test/registry.test.ts` now walks every
  proposal's command line down toil's real command tree, which is what caught both.

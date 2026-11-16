# work-item tag and untag on Azure DevOps Services (#618)

- **Services gets Server's recorded `work-item tag` and `untag`**: the same paths, `<id>` and `--tags`, so one tool serves both, and seeding the Services sandbox no longer rewrites `System.Tags` whole through `work-item update` (the seeding session found the gap after #621 had been approved; adding it there would have restarted its review).
- **Services tests the revision it read.** Server's command reads the tags and writes them back with no check (a suspected bug, #69 item 20, kept there as the contract records it). Services' code is its own, so it sends a JSON Patch `test` of `/rev` first, as `work-item update --rev` does: a tag added in between makes the server refuse the change rather than lose it. The tool description says how each deployment behaves.
- **Services reads only `System.Tags`** (`?fields=System.Tags`), the one field the change needs, rather than the whole item.
- **A call that changes nothing sends nothing on Services** and returns the item as read: no new revision, and no history entry, for a tag already there or one already gone. Server keeps sending the list it read, as recorded.
- **`untag` uses `replace`, and `remove` for the last tag**, as Server's fixed `untag` does: Azure DevOps reads `add` on `System.Tags` as "add these", confirmed live on Services on 11 November 2026.
